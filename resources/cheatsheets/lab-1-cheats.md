---
layout: default
title: Lab 1 Cheatsheet
parent: Cheatsheets
grand_parent: Resources
nav_order: 1
---

# Lab 1: Foundation & CI/CD Bootstrapping Cheatsheet

## Key Commands

### Project Setup
```bash
# Initialize CDK TypeScript project
cdk init app --language typescript

# Install dependencies
npm install aws-cdk-lib constructs
```

### CDK Commands
```bash
# Build TypeScript code
cdk init

# Synthesize CloudFormation template
cdk synth

# Bootstrap CDK environment
cdk bootstrap aws://ACCOUNT-NUMBER/REGION

# Deploy stacks
cdk deploy --all
```

### Git Commands
```bash
# Check status
git status

# Add all files
git add .

# Commit changes
git commit -m "Lab 1: Implement Core/Compute stacks and basic CI/CD"

# Push to GitLab
git push origin main
```

## Key Concepts

- **CDK App**: Entry point for CDK application
- **Stacks**: Deployable units containing resources
- **Constructs**: Building blocks for AWS resources
- **VPC Lookup**: Importing existing VPC using `Vpc.fromLookup()`
- **Cross-Stack References**: Passing resources as props between stacks
- **Aspects**: Applying modifications/validations across resources
- **GitLab CI/CD**: Pipeline stages, jobs, and runners

## Important Files

- `bin/doc-pipeline-lab.ts`: Main app entry point
- `lib/core-stack.ts`: S3 bucket and SQS queue
- `lib/compute-stack.ts`: EC2 instance configuration
- `lib/tagging-aspect.ts`: Resource tagging implementation
- `.gitlab-ci.yml`: CI/CD pipeline definition


# Lab 1 Troubleshooting Summary & Tips

This summarizes the issues encountered and solutions applied while setting up the initial Lab 1 CDK application and GitLab CI/CD pipeline. The final working state uses the code from `lab1_instructions_v5_final` and the associated CI/CD YAML within it (conceptually matching the structure of `gitlab_ci_v15_conventional_order` which used multi-line scripts for main jobs).

## 1. GitLab CI/CD YAML Syntax Errors

* **Problem:** GitLab pipeline fails immediately, reporting YAML syntax errors like:
    * `mapping values are not allowed in this context`
    * `script config should be a string or a nested array of strings...`
    * `could not find expected ':' while scanning a simple key`
* **Diagnosis:** Invalid YAML according to GitLab's parser. Common causes include:
    * **Incorrect Indentation:** Using tabs instead of spaces, or inconsistent numbers of spaces for indentation. Keys at the same level in a map must have the exact same starting column.
    * **Incorrect Structure:** Trying to put a key-value pair where a list item is expected, or vice-versa.
    * **Parser Sensitivity:** GitLab's parser might be stricter than some online validators or editors regarding certain structures like inline maps (`{...}`) or how multi-line strings are handled within lists.
    * **Copy-Paste Issues:** Copying code from web pages or documents can sometimes introduce hidden characters or mess up whitespace.
* **Solutions & Tips:**
    * **Use Spaces, Not Tabs:** Configure your editor to use spaces for indentation (typically 2 spaces per level is standard for YAML).
    * **Validate YAML:** Use your editor's YAML linter or GitLab's built-in CI Lint tool (`CI/CD` -> `Editor` or `CI/CD` -> `Pipelines` -> `CI Lint`) to check syntax before committing.
    * **Standard Formatting:** Prefer standard YAML structures over shorthand where issues occur:
        * Use indented maps (`key:\n subkey: value`) instead of inline maps (`key: { subkey: value }`).
        * For `script:` blocks: Use the standard list format (`- command`) for simple scripts. For complex scripts (multi-line shell, `if` checks), the multi-line literal block (`script: |`) proved most reliable in this workshop's GitLab environment for the main jobs (`bootstrap_dev`, `build_cdk`, `deploy_to_dev`).
    * **Key Order:** While YAML key order usually doesn't matter functionally, sticking to a consistent order (like the conventional one used in the final working CI file) might help avoid parser issues in some environments.
    * **Copy Carefully:** Use "copy code" buttons or paste into a plain text editor first.

## 2. CDK TypeScript Compilation Errors in CI

* **Problem:** Pipeline fails during `build` or `deploy` stage with TS errors (`TS2307: Cannot find module 'aws-cdk-lib'`, `TS2580: Cannot find name 'process'`).
* **Diagnosis:** `node_modules` directory missing in the job stage running `tsc` or `npx cdk`. Dependencies installed in `build` weren't available in `deploy`.
* **Solution:** Run **`npm ci`** at the beginning of the `script:` block for **every** job stage needing Node dependencies (`bootstrap_dev`, `build_cdk`, `deploy_to_dev`). Use `cache:` for `node_modules` with appropriate `policy` (`pull-push` for build, `pull` for others).

* **Problem:** TS error `TS2339: Property 'addDependency' does not exist...`.
* **Diagnosis:** TS compiler error finding the method in the CI environment.
* **Solution:** Remove the explicit `.addDependency()` call in `bin/app.ts`. CDK infers dependencies automatically when props (like the queue) are passed between stacks.

## 3. CDK Context Lookups Failing in CI (`Vpc.fromLookup`)

* **Problem:** Pipeline fails (`synth`/`deploy`) with `Error: App at '' should be created in the scope of a Stack...` during `Vpc.fromLookup`.
* **Diagnosis:** CDK lacks necessary AWS Account/Region context during synthesis in CI for the lookup, even with valid credentials.
* **Solution (Combined):**
    * Move `Vpc.fromLookup` *inside* a Stack constructor (e.g., `ComputeStack`) using `this` as scope.
    * Explicitly pass account/region via context flags (`-c account=${AWS_ACCOUNT_ID} -c region=${AWS_DEFAULT_REGION}`) to `cdk synth` and `cdk deploy` commands in `.gitlab-ci.yml`.
    * Update `bin/app.ts` to read context first (`app.node.tryGetContext(...)`).
    * Add `if [ -z "$VAR" ]` checks in CI scripts before CDK commands for robustness.

## 4. EC2 UserData Script Runtime Errors

* **Problem:** Pipeline deploys, but EC2 script fails (log files missing/empty/wrong owner, process not running).
* **Diagnosis:** UserData script failed during execution (runs as root, typically stops on first error).
* **Debugging:** Add `set -ex` as the *first* command in `userData.addCommands([...])` in CDK code for more detailed logs on failure. Connect via Session Manager and check `/var/log/cloud-init-output.log` for the exact error.
* **Specific Issues & Solutions:**
    * **`--region` error:** `aws: error: argument --region: expected one argument`. Caused by `${AWS_REGION}` being empty/not sourced when used with `--region` flag. **Fix:** Remove explicit `--region` flag from `aws sqs receive-message` command in UserData; let AWS CLI auto-detect from instance metadata.
    * **`${QUEUE_URL}` empty:** Script file shows empty value for queue URL. Caused by failure to resolve CDK token `props.processingQueue.queueUrl` when writing/sourcing `/etc/environment`. **Fix:** Avoid `/etc/environment`. Define script content as a TS template literal (`const pollingScript = \`...\`;`), embedding `${props.processingQueue.queueUrl}` directly. Use heredoc (`cat <<'EOF' > file ... EOF`) within `addCommands` to write the script file.
    * **Shell syntax `(` error:** `syntax error near unexpected token \`('`. Caused by unquoted parentheses `()` in `echo` command string. **Fix:** Add double quotes `"..."` around the entire string argument for the `echo` command within the `pollingScript` definition in CDK code.
    * **Files missing/wrong owner:** Caused by UserData script failing before `touch`/`chown` commands. **Fix:** Resolve the preceding error. Ensure `touch file && chown user:group file` commands exist and are correct.

## 5. EC2 Instance Not Updating with New UserData

* **Problem:** `cdk deploy` succeeds, but EC2 instance runs old UserData script.
* **Diagnosis:** CloudFormation didn't detect a change requiring instance replacement (UserData change alone might not be enough).
* **Solution (for Debugging/Workshops):** Force replacement by changing the instance's logical ID in CDK code: `const instanceLogicalId = \`ProcessingInstance-${Date.now()}\`; const instance = new ec2.Instance(this, instanceLogicalId, { ... });`. Remove this dynamic ID once UserData is stable if desired.