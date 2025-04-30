---
layout: default
title: Lab 2 Hands-on Instructions
nav_order: 21
has_children: true
---
# Lab 2: Cross-Account CI/CD + Resource Prefixing

## Goal

 Modify your CI/CD pipeline to securely deploy your stacks to a second "Prod" AWS account using an assumed IAM role. Implement a manual approval step for production deployments. Modify your CDK application to use context parameters for unique resource prefixing based on student ID and environment.

## Prerequisites

* Completion of Lab 1. Your CDK project should be in GitLab, and the Dev pipeline working.
* **Instructor Provided Information:**
    * **Prod AWS Account ID:** The 12-digit ID of the target production account.
    * **Prod Region:** The AWS region for the production deployment (might be the same or different from Dev).
    * **`CDKDeployRole` ARN:** The full ARN of the IAM role pre-created in the Prod account that your GitLab CI job needs to assume (e.g., `arn:aws:iam::PROD_ACCOUNT_ID:role/CDKDeployRole`).
* Your local environment configured if making changes locally (Node, CDK, Git, AWS Creds for Dev).

## Step 0: Verify Starting Code

Before making changes for Lab 2, let's ensure your key files match the final working state from Lab 1 after troubleshooting.

1.  **Check `.gitlab-ci.yml`:** Your file should look like the version from the end of Lab 1. Key features: conventional key order, `script: |` for main jobs, `npm ci` in relevant jobs, `if` checks and `-c` flags included.
    > **Note:** If your file doesn't match, please update it now using the content from the end of Lab 1 before proceeding.

2.  **Check `bin/<your-project-name>.ts`:** Your app entry point should look like the version from the end of Lab 1. Key features: Reads context/env vars for account/region, instantiates stacks *without* doing VPC lookup here, applies aspects.
    > **Note:** If your file doesn't match, please update it now using the content from the end of Lab 1 before proceeding.

3.  **Check `lib/compute-stack.ts`:** Your compute stack should look like the version from the end of Lab 1. Key features: Performs `Vpc.fromLookup` inside constructor, uses heredoc to create `poll_sqs.sh` with embedded queue URL and quoted `echo`, forces instance replacement via logical ID.
    > **Note:** If your file doesn't match, please update it now using the content from the end of Lab 1 before proceeding.

## Step 1: Understand the Cross-Account Strategy**

* **Goal:** Deploy the same CDK code to a separate Prod AWS account for isolation and safety.
* **Mechanism:** Your GitLab runner (using its existing Dev credentials/role) will temporarily assume the `CDKDeployRole` in the Prod account. It gets short-lived credentials specific to that role in the Prod account. It then uses *these temporary credentials* to run `cdk bootstrap` and `cdk deploy` targeting the Prod account/region.
* **Security:** This relies on a trust relationship configured on the `CDKDeployRole` in Prod, explicitly allowing assumption by the role/user associated with your GitLab runner in the Dev/CI account.

## Step 2: Modify `.gitlab-ci.yml` for Prod Deployment**

1.  **Open `.gitlab-ci.yml`:** Open your verified starting file from Step 0.

2.  **Add Prod Stages:** Find the `stages:` list near the top and **add** the new stages for production:
    
    ```yaml
    stages:
      - bootstrap      # Bootstraps Dev
      - validate       # Validates Dev connection
      - build          # Builds CDK app
      - deploy-dev     # Deploys to Dev
      - bootstrap-prod # ADD THIS STAGE
      - deploy-prod    # ADD THIS STAGE
    ```

3.  **Add `bootstrap_prod` Job:** Add the following **new job definition** to the *end* of the `.gitlab-ci.yml` file. Note the conventional key order.
    ```yaml
    # Job to Bootstrap the Prod environment (Run manually when needed)
    bootstrap_prod:
      stage: bootstrap-prod
      image: public.ecr.aws/sam/build-nodejs18.x:latest
      tags: [cdk] # Assuming 'cdk' runner tag
      cache: # Setup keys first (conventional order)
        key:
          files:
            - package-lock.json
        paths:
          - node_modules/
        policy: pull
      # No needs
      # No dependencies
      script: | # Script block
        echo "Installing dependencies for bootstrap job..."
        npm ci
        # --- Add jq install if needed ---
        # The 'aws sts assume-role' command below uses jq to parse JSON.
        # If jq is not included in the base node image, uncomment and adapt one of the following lines:
        # echo "Ensuring jq is installed..."
        # apt-get update && apt-get install -y jq || apk add --no-cache jq # Example for Debian/Alpine based images
        echo "Attempting to assume role in Prod account: ${PROD_ACCOUNT_ID}..."
        # --- Assume Role Script ---
        # Replace <CDKDeployRole_ARN> with the ARN provided by the instructor
        # Ensure PROD_ACCOUNT_ID and PROD_REGION are set as GitLab CI/CD variables
        # Note about ROLE_ARN: While PROD_ACCOUNT_ID and PROD_REGION are set as variables for flexibility,
        # the ROLE_ARN is kept inline here for clarity during the lab, ensuring you consciously use
        # the specific role ARN provided. In a real-world scenario, this might also be a protected variable.
        ROLE_ARN="<CDKDeployRole_ARN>" # !!! REPLACE THIS !!!
        SESSION_NAME="GitLab-ProdBootstrap-${CI_PIPELINE_ID}"
        echo "Assuming Role ARN: ${ROLE_ARN}"
        CREDENTIALS=$(aws sts assume-role --role-arn "${ROLE_ARN}" --role-session-name "${SESSION_NAME}" --query 'Credentials' --output json)
        if [ -z "$CREDENTIALS" ] || [ "$CREDENTIALS" == "null" ]; then echo "Failed to assume role! Check Role ARN, Trust Policy, and Prod Account ID variable."; exit 1; fi
        export AWS_ACCESS_KEY_ID=$(echo $CREDENTIALS | jq -r '.AccessKeyId')
        export AWS_SECRET_ACCESS_KEY=$(echo $CREDENTIALS | jq -r '.SecretAccessKey')
        export AWS_SESSION_TOKEN=$(echo $CREDENTIALS | jq -r '.SessionToken')
        if [ "$AWS_ACCESS_KEY_ID" == "null" ]; then echo "Failed to parse credentials from assumed role! Is jq installed?"; exit 1; fi
        echo "Role assumed successfully. Session token expires at: $(echo $CREDENTIALS | jq -r '.Expiration')"
        # Verify assumed identity
        echo "Verifying assumed identity..."
        aws sts get-caller-identity
        # Bootstrap Prod Env using assumed creds
        echo "Bootstrapping Prod environment (Account: ${PROD_ACCOUNT_ID} Region: ${PROD_REGION})..."
        if [ -z "$PROD_ACCOUNT_ID" ] || [ -z "$PROD_REGION" ]; then echo "PROD_ACCOUNT_ID or PROD_REGION variable not set!"; exit 1; fi
        # Pass context explicitly
        npx cdk bootstrap "aws://${PROD_ACCOUNT_ID}/${PROD_REGION}" \
          --require-approval never \
          -c account=${PROD_ACCOUNT_ID} \
          -c region=${PROD_REGION}
        echo "Bootstrap complete for Prod environment."
      # No artifacts
      # No environment
      rules: # Control keys last
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
      when: manual # Only run when manually triggered from GitLab UI
      allow_failure: false # Fail the pipeline if manual bootstrap fails
    ```
    > **Action Required:**
    > * Replace `<CDKDeployRole_ARN>` with the actual ARN provided by your instructor.
    > * Ensure `PROD_ACCOUNT_ID` and `PROD_REGION` are configured as **CI/CD variables** in your GitLab project settings (Settings -> CI/CD -> Variables). Mask these variables if possible.
    > * Check/add `jq` install if needed.

4.  **Add `deploy_prod` Job:** Add the following **new job definition** to the *end* of the `.gitlab-ci.yml` file. Note the conventional key order and manual trigger.
    ```yaml
    # Job to deploy the CDK application to the Prod environment
    deploy_to_prod:
      stage: deploy-prod
      image: public.ecr.aws/sam/build-nodejs18.x:latest
      tags: [cdk] # Assuming 'cdk' runner tag
      cache: # Setup keys first
        key:
          files:
            - package-lock.json
        paths:
          - node_modules/
        policy: pull
      needs: # Setup keys first
        - job: build_cdk # Depends on build_cdk completing successfully
      dependencies: [build_cdk] # Download cdk.out artifact
      script: | # Script block
        echo "Installing dependencies for deploy job..."
        npm ci
        # --- Add jq install if needed ---
        # Uncomment the appropriate line below if jq is not in the base node image
        # echo "Ensuring jq is installed..."
        # apt-get update && apt-get install -y jq || apk add --no-cache jq # Example for Debian/Alpine
        echo "Attempting to assume role in Prod account: ${PROD_ACCOUNT_ID}..."
        # --- Assume Role Script (same as bootstrap_prod) ---
        # Note about ROLE_ARN: See note in bootstrap_prod job.
        ROLE_ARN="<CDKDeployRole_ARN>" # !!! REPLACE THIS !!!
        SESSION_NAME="GitLab-ProdDeploy-${CI_PIPELINE_ID}"
        echo "Assuming Role ARN: ${ROLE_ARN}"
        CREDENTIALS=$(aws sts assume-role --role-arn "${ROLE_ARN}" --role-session-name "${SESSION_NAME}" --query 'Credentials' --output json)
        if [ -z "$CREDENTIALS" ] || [ "$CREDENTIALS" == "null" ]; then echo "Failed to assume role!"; exit 1; fi
        export AWS_ACCESS_KEY_ID=$(echo $CREDENTIALS | jq -r '.AccessKeyId')
        export AWS_SECRET_ACCESS_KEY=$(echo $CREDENTIALS | jq -r '.SecretAccessKey')
        export AWS_SESSION_TOKEN=$(echo $CREDENTIALS | jq -r '.SessionToken')
        if [ "$AWS_ACCESS_KEY_ID" == "null" ]; then echo "Failed to parse credentials from assumed role! Is jq installed?"; exit 1; fi
        echo "Role assumed successfully. Session token expires at: $(echo $CREDENTIALS | jq -r '.Expiration')"
        # Verify assumed identity
        echo "Verifying assumed identity..."
        aws sts get-caller-identity
        # Deploy using assumed creds and Prod context
        echo "Deploying stacks to Prod environment (Account: ${PROD_ACCOUNT_ID} Region: ${PROD_REGION})..."
        if [ -z "$PROD_ACCOUNT_ID" ] || [ -z "$PROD_REGION" ]; then echo "PROD_ACCOUNT_ID or PROD_REGION variable not set!"; exit 1; fi
        # *** Define your unique prefix (e.g., using GitLab User Login) ***
        # Replace 'stuXX' with a unique identifier. Using $GITLAB_USER_LOGIN requires it to be available.
        # Alternatively, use a predefined student ID variable like $STUDENT_ID set in GitLab variables.
        STUDENT_PREFIX="${GITLAB_USER_LOGIN:-stuXX}" # Example: Use GitLab login or default 'stuXX'
        PROD_PREFIX="${STUDENT_PREFIX}-prod"
        echo "Using prefix: ${PROD_PREFIX}"
        # Pass context explicitly, including prefix and environment
        # Note: Command broken onto multiple lines using \ for readability
        npx cdk deploy --all \
          --require-approval never \
          --outputs-file cdk-outputs-prod.json \
          -c account=${PROD_ACCOUNT_ID} \
          -c region=${PROD_REGION} \
          -c prefix=${PROD_PREFIX} \
          -c environment=prod
        echo "Deployment to Prod complete."
      artifacts: # Post-execution keys
        paths:
          - cdk-outputs-prod.json # Use different name for prod outputs
        expire_in: 1 day
      environment: # Post-execution keys
        name: production
        # url: <Your Production URL if applicable>
      rules: # Control keys last
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
      when: manual # *** IMPORTANT: Makes this a manual action in GitLab UI ***
      allow_failure: false # Fail pipeline if manual deploy fails
    ```
    > **Action Required:**
    > * Replace `<CDKDeployRole_ARN>` again.
    > * Modify the `STUDENT_PREFIX` line to use a suitable unique identifier (e.g., `$GITLAB_USER_LOGIN` or `$STUDENT_ID` variable).
    > * Check if `jq` needs to be installed.

5.  **Modify `deploy_to_dev` Job:** Find the existing `deploy_to_dev` job. Ensure its `stage:` key is `deploy-dev`. **Modify its `script:` block** to add the context flags (`-c prefix=... -c environment=dev`).
    ```yaml
    # Find the existing deploy-dev job and modify its stage and script block

    deploy_to_dev:
      stage: deploy-dev 
      # ... (image, tags, cache, needs, dependencies using conventional order from Lab 1 final) ...
      script: | # Keep multi-line format
        echo "Installing dependencies for deploy job..."
        npm ci
        echo "Deploying stacks to Dev environment (Region: ${AWS_DEFAULT_REGION:-check_runner_config})..."
        # Check Dev variables (these likely come from default GitLab config)
        if [ -z "$AWS_ACCOUNT_ID" ] || [ -z "$AWS_DEFAULT_REGION" ]; then
          echo "Error: AWS_ACCOUNT_ID or AWS_DEFAULT_REGION is not set for Dev."
          exit 1
        fi
        # *** Define unique prefix for Dev ***
        STUDENT_PREFIX="${GITLAB_USER_LOGIN:-stuXX}" # Use same logic as Prod
        DEV_PREFIX="${STUDENT_PREFIX}-dev"
        echo "Using prefix: ${DEV_PREFIX}"
        # *** Modify cdk deploy command to ADD context flags ***
        # Note: Command broken onto multiple lines using \ for readability
        npx cdk deploy --all \
          --require-approval never \
          --outputs-file cdk-outputs.json \
          -c account=${AWS_ACCOUNT_ID} \
          -c region=${AWS_DEFAULT_REGION} \
          -c prefix=${DEV_PREFIX} \
          -c environment=dev
        echo "Deployment complete."
      # ... (artifacts, environment, rules using conventional order from Lab 1 final) ...
    ```
    > **Action Required:** Modify the `STUDENT_PREFIX` line consistently.

---

## Step 3: Implement Resource Prefixing in CDK Code

1.  **Modify `bin/<your-project-name>.ts`:** Update the app entry point (use your verified starting code from Step 0) to **read the new context variables** (`prefix`, `environment`) and use them when creating Stack IDs and setting tags.
    ```typescript
    #!/usr/bin/env node
    import 'source-map-support/register';
    import * as cdk from 'aws-cdk-lib';
    import { CoreStack } from '../lib/core-stack';
    import { ComputeStack } from '../lib/compute-stack';
    import { BasicTagger } from '../lib/tagging-aspect';

    const app = new cdk.App();

    // --- Read Context Variables ---
    // Get prefix and environment passed via -c flags from CI/CD.
    // Provide sensible defaults for local execution if context isn't passed.
    const environment = app.node.tryGetContext('environment') || 'dev'; // Default to 'dev'
    // Default prefix combines 'stuXX' and environment. Replace 'stuXX' if using a different default/variable.
    const prefix = app.node.tryGetContext('prefix') || `stuXX-${environment}`;
    console.log(`Using Prefix: ${prefix}, Environment: ${environment}`);

    // --- Determine Target Account and Region ---
    // Read from context first, then environment variables
    const targetAccount = app.node.tryGetContext('account') ||
                          process.env.CDK_DEFAULT_ACCOUNT ||
                          process.env.AWS_ACCOUNT_ID;
    const targetRegion = app.node.tryGetContext('region') ||
                         process.env.CDK_DEFAULT_REGION ||
                         process.env.AWS_DEFAULT_REGION;

    // Validate
    if (!targetAccount) { throw new Error("Account context/variable not set"); }
    if (!targetRegion) { throw new Error("Region context/variable not set"); }
    console.log(`Targeting AWS Account: ${targetAccount} Region: ${targetRegion}`);

    const deploymentProps = {
      env: { account: targetAccount, region: targetRegion },
    };

    // --- Instantiate Stacks with Prefixed IDs ---
    // *** CHANGE: Use the prefix in the Stack ID ***
    console.log('Instantiating CoreStack...');
    const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);

    console.log('Instantiating ComputeStack...');
    // *** CHANGE: Use the prefix in the Stack ID ***
    const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
      ...deploymentProps,
      processingQueue: coreStack.queue,
    });

    // --- Apply Aspects with Environment & Prefix Tags ---
    console.log('Applying aspects for tagging...');
    // *** CHANGE: Use the environment variable for the tag ***
    cdk.Aspects.of(app).add(new BasicTagger('environment', environment));
    cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
    // *** CHANGE: Add prefix tag ***
    cdk.Aspects.of(app).add(new BasicTagger('prefix', prefix));
    console.log('Tagging aspects applied.');
    ```
    > **Action Required:** Replace `stuXX` in the default prefix calculation (`stuXX-${environment}`) if you used a different default or variable (like `$STUDENT_ID`) in your CI/CD file.

2.  **(Optional) Modify Stacks for Prefixed Resource Names:** We will **skip** explicitly naming resources like buckets/queues with prefixes for now. Stack name prefixing and tagging are sufficient for this lab.

---

## Step 4: Deploy and Verify

1.  **Commit and Push:** Save all changes to `.gitlab-ci.yml` and `bin/<your-project-name>.ts`. Commit and push to GitLab.
    * **Using GitLab Web UI:** Commit the changes directly using the UI options.
    * **Using VS Code + Git CLI:** Stage, commit, and push your changes using the terminal:
        ```bash
        git add .
        git commit -m "Lab 2: Add Prod deploy stage and resource prefixing"
        git push origin main # Or master
        ```

2.  **Monitor Dev Pipeline:** Go to `Build -> Pipelines` in GitLab. Verify the pipeline runs successfully for the `dev` stages (`bootstrap_dev` might be skipped, `validate`, `build`, `deploy_dev`).
    * Check CloudFormation in the **Dev** account. The stack names should now include your unique prefix (e.g., `stuXX-dev-CoreStack`, `stuXX-dev-ComputeStack`). Resources should be tagged with `environment: dev` and `prefix: stuXX-dev`.

3.  **Bootstrap Prod (If First Time):**
    * In the GitLab pipeline view, find the `bootstrap_prod` job. It should be in a `manual` state (look for a "play" icon).
    * Click the **"play" icon** to run it.
    * Monitor the job log in GitLab. Ensure it successfully assumes the role (check the `aws sts get-caller-identity` output) and runs `cdk bootstrap` in the Prod account/region without errors.

4.  **Deploy to Prod:**
    * In the GitLab pipeline view, find the `deploy_prod` job. It should also be in a `manual` state.
    * Click the **"play" icon** to run it. This simulates a manual approval/promotion to production.
    * Monitor the job log. Verify it assumes the role successfully and runs `cdk deploy` without errors.

5.  **Verify Prod Resources:**
    * Log in to the **Prod** AWS account/region (using the Console or appropriate credentials).
    * Go to **CloudFormation**. Verify the stacks (`stuXX-prod-CoreStack`, `stuXX-prod-ComputeStack`) exist and are in `CREATE_COMPLETE` status.
    * Briefly check **S3**, **SQS**, **EC2** to verify the corresponding resources were created.
    * Check the **Tags** on a resource (like the S3 bucket or EC2 instance). They should include `environment: prod` and `prefix: stuXX-prod`.

6.  **Verify Dev Resources:** Briefly check the Dev AWS account again to ensure resources there were not affected by the Prod deployment. Stack names and tags should still reflect the `dev` environment.

---

## Step 5: Clean Up Resources

### --- Destroy Dev Environment ---

1. Ensure your local terminal is using AWS credentials for the DEV account.
   (This is likely your default profile configured with 'aws configure').
   You can verify using: aws sts get-caller-identity --profile YOUR_DEV_PROFILE_NAME (or omit profile for default)

2. Run cdk destroy, providing the FULL DEV PREFIX used during deployment via the '-c prefix' flag.
   Also provide environment, account, and region context.
   Replace YOUR_FULL_DEV_PREFIX (e.g., yourlogin-dev), AWS_ACCOUNT_ID (Dev), and AWS_DEFAULT_REGION (Dev) below.

```bash
npx cdk destroy --all -c prefix=YOUR_FULL_DEV_PREFIX -c environment=dev -c account=AWS_ACCOUNT_ID -c region=AWS_DEFAULT_REGION
```

### --- Destroy Prod Environment (ONLY IF YOU DEPLOYED TO PROD) ---

To destroy resources in Prod, you need to run 'cdk destroy' using credentials
that have permission in the Prod account (specifically, the CDKDeployRole).
Since Prod credentials aren't configured locally with 'aws configure', assume the Prod role using your Dev credentials by running the following commands one line at a time in your terminal:

1. Define Variables (replace placeholders):
   Get the Prod Role ARN from your instructor.
   Set your configured Dev AWS profile name (often 'default').

    ```bash
    PROD_ROLE_ARN="<CDKDeployRole_ARN_Prod>" 
    DEV_PROFILE="default"                
    ```

2. Assume the Prod Role using Dev Credentials:
   This command uses your Dev profile to call STS and get temporary Prod credentials.    Ensure 'jq' is installed locally (`brew install jq` or equivalent).

    ```bash
    echo "Attempting to assume Prod role: ${PROD_ROLE_ARN}..."
    CREDENTIALS=$(aws sts assume-role --role-arn "${PROD_ROLE_ARN}" --role-session-name "LocalCleanupSession-${USER:-unknown}" --profile "${DEV_PROFILE}" --query 'Credentials' --output json)
    ```

3. Manually Check if Assume Role Succeeded:
   Run the command below. It should output JSON text containing keys.
   If it's empty or shows 'null', the assume-role failed. Check your ARN, Dev profile name, and the role's trust policy in AWS.

    ```bash
    echo $CREDENTIALS
    ```

4. Export Temporary Credentials (ONLY if Step 3 showed valid JSON):
   Ensure 'jq' is installed locally (`brew install jq` or `sudo apt-get install jq` or equivalent).
   Run these commands one by one:

    ```bash
    export AWS_ACCESS_KEY_ID=$(echo $CREDENTIALS | jq -r '.AccessKeyId')
    export AWS_SECRET_ACCESS_KEY=$(echo $CREDENTIALS | jq -r '.SecretAccessKey')
    export AWS_SESSION_TOKEN=$(echo $CREDENTIALS | jq -r '.SessionToken')
    ```

5. Manually Check if Credentials Parsed Correctly:
   Run the command below. It should output the Access Key ID.
    If it's empty or shows 'null', the export failed. Check if jq is installed and if $CREDENTIALS had valid JSON.

    ```bash
    echo $AWS_ACCESS_KEY_ID
    ```

6. Verify Assumed Identity (Optional but recommended, run only if Step 5 worked):
   This command should now show the AssumedRole ARN in the output.

    ```bash
    echo "Verifying identity (should show assumed role):"
    aws sts get-caller-identity
    ```

7. Run cdk destroy for Prod (Run only if Step 5 & 6 worked):
   Provide the FULL PROD PREFIX used during deployment via the '-c prefix' flag.
   Also provide environment, account, and region context.
   Replace YOUR_FULL_PROD_PREFIX (e.g., yourlogin-prod), PROD_ACCOUNT_ID, and PROD_REGION below.

    ```bash
    echo "Running cdk destroy for Prod..."
    npx cdk destroy --all -c prefix=YOUR_FULL_PROD_PREFIX -c environment=prod -c account=PROD_ACCOUNT_ID -c region=PROD_REGION
    ```

8. IMPORTANT: Unset the temporary credentials after 'cdk destroy' finishes!
   Run these commands one by one:

    ```bash
    echo "Unsetting temporary credentials..."
    unset AWS_ACCESS_KEY_ID
    unset AWS_SECRET_ACCESS_KEY
    unset AWS_SESSION_TOKEN
    echo "Prod cleanup attempt finished."
    ```



---

## Congratulations!

You have successfully configured a multi-stage GitLab CI/CD pipeline with cross-account deployment to a Prod environment, including a manual approval step. You have also implemented resource prefixing using CDK context to ensure environment isolation and prevent naming collisions.

