---
layout: default
title: Lab 3 Cheatsheet
parent: Cheatsheets
grand_parent: Resources
nav_order: 3
---

# Lab 3 Troubleshooting Tips (Custom Resource Lambda & EC2 Script)

This covers common issues encountered when adding the DynamoDB table, Comprehend call, and the Custom Resource Seeder in Lab 3.

## 1. Custom Resource Lambda (`DDBSeedHandler`) Errors

* **Problem:** CloudFormation rollback during `CoreStack` deployment. Error in `DDBSeedResource` details mentions `Cannot find module 'aws-sdk'` or `aws: command not found`.
    * **Diagnosis:** The inline Lambda code used initially relied on tools (AWS SDK v2 or AWS CLI) that are **not** reliably included in modern Node.js Lambda runtimes (like Node.js 18+). Trying to use older runtimes (like Node.js 16) is also not viable as they are deprecated. Using AWS SDK v3 directly in inline code fails because CDK doesn't automatically bundle dependencies for inline functions.
    * **Solution:** Use the **`aws-lambda-nodejs.NodejsFunction`** construct in `lib/core-stack.ts`.
        1.  Write the Lambda handler logic in a separate TypeScript file (e.g., `lambda/seed-ddb.ts`).
        2.  Use **AWS SDK v3** syntax (`import { DynamoDBClient }...`, `DynamoDBDocumentClient.from()`, `await ddbDocClient.send(new PutCommand(...))`) within the handler file.
        3.  Install the required SDK v3 clients as project dependencies: `npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb`.
        4.  Install Lambda type definitions: `npm install --save-dev @types/aws-lambda`.
        5.  Install `esbuild` if not already present: `npm install --save-dev esbuild`.
        6.  Define the Lambda in CDK using `new lambda_nodejs.NodejsFunction`, setting the `entry` property to the path of your handler file (e.g., `'lambda/seed-ddb.ts'`).
        7.  Pass the `TABLE_NAME` as an environment variable in the `NodejsFunction` definition.
        8.  Use this `NodejsFunction` instance as the `onEventHandler` for the `custom_resources.Provider`.
        9.  Grant permissions as before: `table.grantWriteData(seedHandler)`.
    * **Benefit:** `NodejsFunction` automatically bundles your handler code *and* its SDK v3 dependencies, making it work reliably on modern Lambda runtimes.

* **Problem:** Editor shows error `error is of type unknown` in the `catch` block of `lambda/seed-ddb.ts`.
    * **Diagnosis:** Standard TypeScript behavior for type safety.
    * **Solution:** Use a type guard before accessing properties like `.message`:
        ```typescript
        catch (error) {
          const errorMessage = (error instanceof Error) ? error.message : String(error);
          throw new Error(`Failed...: ${errorMessage}`);
        }
        ```

## 2. EC2 UserData Script (`poll_sqs.sh`) Errors

* **Problem:** TypeScript compilation fails during `cdk synth` or `cdk deploy` with errors like `Cannot find name 'MSG_ID'` originating from the `pollingScript` template literal in `lib/compute-stack.ts`.
    * **Diagnosis:** The TypeScript compiler/linter gets confused parsing shell syntax (`$VAR`, `$(...)`) inside template literals that *also* contain CDK token interpolation (`${props...}`). Attempts to escape shell variables (`\$`) break the runtime script.
    * **Solution (Template + Sed):**
        1.  Define the script content in a TS template literal (`const pollingScriptTemplate = \`...\`;`) using **placeholders** (e.g., `%%QUEUE_URL%%`, `%%TABLE_NAME%%`) instead of CDK tokens, and using **normal shell syntax** (no `\` escaping before `$`).
        2.  In `UserData.addCommands`, first write this template string to a temporary file on the instance using `cat <<'EOF' > /home/ec2-user/poll_sqs.sh.template`. Use the quoted `'EOF'` to prevent premature shell expansion of the template content.
        3.  Use separate `sed` commands within `addCommands` to replace the `%%PLACEHOLDERS%%` with the actual CDK token values (`${props.processingQueue.queueUrl}`, `${props.table.tableName}`), writing the output to the final script file (`/home/ec2-user/poll_sqs.sh`). Use a different delimiter like `|` in `sed` if URLs contain `/`. Example:
            ```typescript
            `sed -e "s|%%QUEUE_URL%%|${props.processingQueue.queueUrl}|g" \\`,
            `    -e "s|%%TABLE_NAME%%|${props.table.tableName}|g" \\`,
            `    /home/ec2-user/poll_sqs.sh.template > /home/ec2-user/poll_sqs.sh`,
            ```

* **Problem:** Script fails at runtime with AWS CLI errors (e.g., `--region` argument missing, `aws: command not found`).
    * **Diagnosis:** Explicitly providing `--region ${AWS_REGION}` is unreliable due to variable sourcing issues in UserData. Hardcoding paths like `/usr/local/bin/aws` is unreliable as the install location can vary.
    * **Solution:** Remove the `--region` flag from `aws` commands in the script; let the CLI auto-detect from instance metadata. Call the CLI using just `aws` (no path) and rely on the system `PATH`; ensure AWS CLI v2 is installed correctly earlier in the UserData.

* **Problem:** Script fails at runtime with shell syntax errors (e.g., `syntax error near unexpected token \`('`).
    * **Diagnosis:** Special characters like `(` or `)` in strings passed to commands like `echo` need proper shell quoting.
    * **Solution:** Ensure arguments containing special characters are enclosed in quotes (usually double quotes `"..."`) within the script definition string (e.g., `echo "Polling SQS Queue: ... (Region...)"`).

* **Problem:** Log files (`sqs_messages.log`, `poll_sqs.out`) are missing or owned by `root`.
    * **Diagnosis:** The UserData script failed execution *before* reaching the `touch` and `chown` commands for those files, or before the `sudo -u ec2-user ... nohup` command ran.
    * **Solution:** Fix the preceding error in the UserData script (check `/var/log/cloud-init-output.log`). Ensure `touch FILE && chown ec2-user:ec2-user FILE` commands exist for all necessary files *after* the script file itself is created and *before* the `sudo -u ... nohup` command runs. Add `set -ex` to the top of `userData.addCommands` to easily spot the failing command in logs.

## 3. General Debugging

* **EC2 Instance Not Updating:** If `cdk deploy` succeeds but the instance runs old UserData, force replacement by changing the instance's logical ID in CDK code (`const instanceLogicalId = \`ProcessingInstance-${Date.now()}\`;`). Remove this once UserData is stable.
* **Check Cloud-Init Logs:** Always check `/var/log/cloud-init-output.log` on the EC2 instance via Session Manager for detailed UserData execution errors.