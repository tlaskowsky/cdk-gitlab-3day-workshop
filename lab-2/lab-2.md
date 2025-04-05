---
layout: default
title: Lab 2 Hands-on Instructions
nav_order: 21
has_children: true
---

# Lab 2: Cross-Account CI/CD + Resource Prefixing #

## Goal

 Modify your CI/CD pipeline to securely deploy your stacks to a second "Prod" AWS account using an assumed IAM role. Implement a manual approval step for production deployments. Modify your CDK application to use context parameters for unique resource prefixing based on student ID and environment.

## Prerequisites:

* Completion of Lab 1. Your CDK project should be in GitLab, and the Dev pipeline working.
* **Instructor Provided Information:**
    * **Prod AWS Account ID:** The 12-digit ID of the target production account.
    * **Prod Region:** The AWS region for the production deployment (might be the same or different from Dev).
    * **`CDKDeployRole` ARN:** The full ARN of the IAM role pre-created in the Prod account that your GitLab CI job needs to assume (e.g., `arn:aws:iam::PROD_ACCOUNT_ID:role/CDKDeployRole`).
* Your local environment configured if making changes locally (Node, CDK, Git, AWS Creds for Dev).

## Step 1: Understand the Cross-Account Strategy

* **Goal:** Deploy the same CDK code to a separate Prod AWS account for isolation and safety.
* **Mechanism:** Your GitLab runner (using its existing Dev credentials/role) will temporarily assume the `CDKDeployRole` in the Prod account. It gets short-lived credentials specific to that role in the Prod account. It then uses *these temporary credentials* to run `cdk bootstrap` and `cdk deploy` targeting the Prod account/region.
* **Security:** This relies on a trust relationship configured on the `CDKDeployRole` in Prod, explicitly allowing assumption by the role/user associated with your GitLab runner in the Dev/CI account.

## Step 2: Modify `.gitlab-ci.yml` for Prod Deployment**

1.  **Open `.gitlab-ci.yml`:** Edit the file locally or using the GitLab UI/IDE.

2.  **Add Prod Stages:** Add new stages for bootstrapping and deploying to production *after* the dev stages. Find the `stages:` list near the top and modify it:
    
    ```yaml
    stages:
      - bootstrap      # Bootstraps Dev
      - validate       # Validates Dev connection
      - build          # Builds CDK app
      - deploy-dev     # Deploys to Dev
      - bootstrap-prod # Bootstraps Prod (runs only before first prod deploy)
      - deploy-prod    # Deploys to Prod (manual trigger)
    
    ```

3.  **Add `bootstrap-prod` Job:** Add the following new job definition to the end of the file. This job bootstraps the Prod environment and requires manual triggering.
    ```yaml
    # Job to Bootstrap the Prod environment (Run manually when needed)
    bootstrap_prod:
      stage: bootstrap-prod
      image: node:${NODE_VERSION} # Assuming NODE_VERSION is defined in variables
      tags: [cdk] # Assuming 'cdk' runner tag
      cache: # Pull cache for dependencies
        key:
          files:
            - package-lock.json
        paths:
          - node_modules/
        policy: pull
      script: |
        echo "Installing dependencies for bootstrap job..."
        npm ci
        echo "Attempting to assume role in Prod account: ${PROD_ACCOUNT_ID}..."
        # --- Assume Role Script ---
        # Replace <CDKDeployRole_ARN> with the ARN provided by the instructor
        # Ensure PROD_ACCOUNT_ID and PROD_REGION are set as GitLab CI/CD variables
        ROLE_ARN="<CDKDeployRole_ARN>" # !!! REPLACE THIS !!!
        SESSION_NAME="GitLab-ProdBootstrap-${CI_PIPELINE_ID}"
        echo "Assuming Role ARN: ${ROLE_ARN}"
        # Use AWS CLI to assume the role and capture credentials. Ensure jq is available or parse differently.
        # Consider adding 'apk add --no-cache jq' or 'apt-get update && apt-get install -y jq' if jq isn't in the Node image.
        CREDENTIALS=$(aws sts assume-role --role-arn "${ROLE_ARN}" --role-session-name "${SESSION_NAME}" --query 'Credentials' --output json)
        if [ -z "$CREDENTIALS" ] || [ "$CREDENTIALS" == "null" ]; then echo "Failed to assume role! Check Role ARN, Trust Policy, and Prod Account ID variable."; exit 1; fi
        export AWS_ACCESS_KEY_ID=$(echo $CREDENTIALS | jq -r '.AccessKeyId')
        export AWS_SECRET_ACCESS_KEY=$(echo $CREDENTIALS | jq -r '.SecretAccessKey')
        export AWS_SESSION_TOKEN=$(echo $CREDENTIALS | jq -r '.SessionToken')
        if [ "$AWS_ACCESS_KEY_ID" == "null" ]; then echo "Failed to parse credentials from assumed role!"; exit 1; fi
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
      when: manual # Only run when manually triggered from GitLab UI
      allow_failure: false # Fail the pipeline if manual bootstrap fails
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
    ```
    > **Action Required:**
    > * Replace `<CDKDeployRole_ARN>` with the actual ARN provided by your instructor.
    > * Ensure `PROD_ACCOUNT_ID` and `PROD_REGION` are configured as **CI/CD variables** in your GitLab project settings (Settings -> CI/CD -> Variables). Mask these variables if possible.
    > * *Note:* The script assumes `jq` is available to parse JSON. If the `node` image doesn't have it, you might need to add an install command (e.g., `apt-get update && apt-get install -y jq` for Debian-based images, or `apk add --no-cache jq` for Alpine-based images) at the start of the script.

4.  **Add `deploy-prod` Job:** Add the following job definition to the end of the file. This job deploys to production, assumes the same role, and requires manual triggering.
    ```yaml
    # Job to deploy the CDK application to the Prod environment
    deploy_to_prod:
      stage: deploy-prod
      image: node:${NODE_VERSION} # Assuming NODE_VERSION is defined in variables
      tags: [cdk] # Assuming 'cdk' runner tag
      cache: # Pull cache for dependencies
        key:
          files:
            - package-lock.json
        paths:
          - node_modules/
        policy: pull
      needs: # Depends on build_cdk completing successfully
        - job: build_cdk
      dependencies: [build_cdk] # Download cdk.out artifact
      script: |
        echo "Installing dependencies for deploy job..."
        npm ci
        echo "Attempting to assume role in Prod account: ${PROD_ACCOUNT_ID}..."
        # --- Assume Role Script (same as bootstrap-prod) ---
        ROLE_ARN="<CDKDeployRole_ARN>" # !!! REPLACE THIS !!!
        SESSION_NAME="GitLab-ProdDeploy-${CI_PIPELINE_ID}"
        echo "Assuming Role ARN: ${ROLE_ARN}"
        # Ensure jq is available if needed
        CREDENTIALS=$(aws sts assume-role --role-arn "${ROLE_ARN}" --role-session-name "${SESSION_NAME}" --query 'Credentials' --output json)
        if [ -z "$CREDENTIALS" ] || [ "$CREDENTIALS" == "null" ]; then echo "Failed to assume role!"; exit 1; fi
        export AWS_ACCESS_KEY_ID=$(echo $CREDENTIALS | jq -r '.AccessKeyId')
        export AWS_SECRET_ACCESS_KEY=$(echo $CREDENTIALS | jq -r '.SecretAccessKey')
        export AWS_SESSION_TOKEN=$(echo $CREDENTIALS | jq -r '.SessionToken')
        if [ "$AWS_ACCESS_KEY_ID" == "null" ]; then echo "Failed to parse credentials from assumed role!"; exit 1; fi
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
        npx cdk deploy --all \
          --require-approval never \
          --outputs-file cdk-outputs-prod.json \
          -c account=${PROD_ACCOUNT_ID} \
          -c region=${PROD_REGION} \
          -c prefix=${PROD_PREFIX} \
          -c environment=prod
        echo "Deployment to Prod complete."
      environment: # Define GitLab environment
        name: production
        # url: <Your Production URL if applicable>
      when: manual # *** IMPORTANT: Makes this a manual action in GitLab UI ***
      allow_failure: false # Fail pipeline if manual deploy fails
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
    ```
    > **Action Required:**
    > * Replace `<CDKDeployRole_ARN>` again.
    > * Modify the `STUDENT_PREFIX` line to use a suitable unique identifier. Using `$GITLAB_USER_LOGIN` is often convenient if available and unique among students. Alternatively, define a CI/CD variable like `STUDENT_ID` in GitLab (Settings -> CI/CD -> Variables) and use `STUDENT_PREFIX="${STUDENT_ID:-stuXX}"`. Discuss with your instructor the preferred method.

5.  **Modify `deploy-dev` Job:** Add the context flags (`-c prefix=... -c environment=dev`) to the `deploy-dev` job as well for consistency and to apply the prefixing scheme to the Dev environment.
    ```yaml
    # Find the existing deploy_to_dev job and modify its script block

    deploy_to_dev:
      # ... (stage, image, tags, cache, needs, dependencies remain same) ...
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
        # *** Add context flags ***
        npx cdk deploy --all \
          --require-approval never \
          --outputs-file cdk-outputs.json \
          -c account=${AWS_ACCOUNT_ID} \
          -c region=${AWS_DEFAULT_REGION} \
          -c prefix=${DEV_PREFIX} \
          -c environment=dev
        echo "Deployment complete."
      # ... (environment, artifacts, rules remain same) ...
    ```
    > **Action Required:** Modify the `STUDENT_PREFIX` line consistently with the choice made for the `deploy-prod` job.

---

## Step 3: Implement Resource Prefixing in CDK Code

1.  **Modify `bin/<your-project-name>.ts`:** Update the app entry point to read the `prefix` and `environment` context variables passed from the CI/CD pipeline and use them when creating Stack IDs.
    ```typescript
    #!/usr/bin/env node
    import 'source-map-support/register';
    import * as cdk from 'aws-cdk-lib';
    import { CoreStack } from '../lib/core-stack';
    import { ComputeStack } from '../lib/compute-stack';
    import { BasicTagger } from '../lib/tagging-aspect';

    const app = new cdk.App();

    // --- Read Context Variables ---
    // Get prefix and environment passed via -c flags.
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
    // Use the resolved prefix in the Stack ID for uniqueness across students/environments
    console.log('Instantiating CoreStack...');
    const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);

    console.log('Instantiating ComputeStack...');
    const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
      ...deploymentProps,
      processingQueue: coreStack.queue,
    });

    // --- Apply Aspects with Environment & Prefix Tags ---
    console.log('Applying aspects for tagging...');
    // Use the environment context variable for the tag value
    cdk.Aspects.of(app).add(new BasicTagger('environment', environment));
    cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
    // Add prefix tag for easier identification in the console
    cdk.Aspects.of(app).add(new BasicTagger('prefix', prefix));
    console.log('Tagging aspects applied.');
    ```
    > **Action Required:** Replace `stuXX` in the default prefix calculation (`stuXX-${environment}`) if you used a different default or variable (like `$STUDENT_ID`) in your CI/CD file, ensuring local `cdk` commands can generate a reasonable default prefix if needed.

2.  **(Optional) Modify Stacks for Prefixed Resource Names:** As mentioned in the lecture notes, prefixing the Stack names (as done above) is often sufficient for this lab. Rely on CDK's auto-generated physical IDs for uniqueness within the stack. We will **skip** explicitly naming resources like buckets/queues with prefixes for now.

---

## Step 4: Deploy and Verify

1.  **Commit and Push:** Save all changes to `.gitlab-ci.yml` and `bin/<your-project-name>.ts`. Commit and push to GitLab.
    ```bash
    git add .
    git commit -m "Lab 2: Add Prod deploy stage and resource prefixing"
    git push origin main
    ```

2.  **Monitor Dev Pipeline:** Go to `Build -> Pipelines` in GitLab. Verify the pipeline runs successfully for the `dev` stages (`bootstrap_dev` might be skipped if already run, `validate`, `build`, `deploy-dev`).
    * Check CloudFormation in the **Dev** account. The stack names should now include your unique prefix (e.g., `stuXX-dev-CoreStack`, `stuXX-dev-ComputeStack`). Resources should be tagged with `environment: dev` and `prefix: stuXX-dev`.

3.  **Bootstrap Prod (If First Time):**
    * In the GitLab pipeline view, find the `bootstrap-prod` job. It should be waiting for manual execution (look for a "play" icon).
    * Click the **"play" icon** to run it.
    * Monitor the job log in GitLab. Ensure it successfully assumes the role (check the `aws sts get-caller-identity` output) and runs `cdk bootstrap` in the Prod account/region without errors.

4.  **Deploy to Prod:**
    * In the GitLab pipeline view, find the `deploy-prod` job. It should also be waiting for manual execution.
    * Click the **"play" icon** to run it. This simulates a manual approval/promotion to production.
    * Monitor the job log. Verify it assumes the role successfully and runs `cdk deploy` without errors.

5.  **Verify Prod Resources:**
    * Log in to the **Prod** AWS account/region (using the Console or appropriate credentials).
    * Go to **CloudFormation**. Verify the stacks (`stuXX-prod-CoreStack`, `stuXX-prod-ComputeStack`) exist and are in `CREATE_COMPLETE` status.
    * Briefly check **S3**, **SQS**, **EC2** to verify the corresponding resources were created.
    * Check the **Tags** on a resource (like the S3 bucket or EC2 instance). They should include `environment: prod` and `prefix: stuXX-prod`.

6.  **Verify Dev Resources:** Briefly check the Dev AWS account again to ensure resources there were not affected by the Prod deployment. Stack names and tags should still reflect the `dev` environment.

---

## Step 5: Cleanup (Optional)

* Cleanup is optional now, but if you wanted to destroy resources, you would run `cdk destroy` locally, targeting each environment separately using the correct context flags:
    ```bash
    # Destroy Dev (ensure local AWS creds point to Dev account/region)
    # Replace stuXX, DEV_ACCOUNT_ID, DEV_REGION with your values
    npx cdk destroy --all -c prefix=stuXX-dev -c environment=dev -c account=DEV_ACCOUNT_ID -c region=DEV_REGION

    # Destroy Prod (ensure local AWS creds point to Prod account/region OR use assumed role locally)
    # Replace stuXX, PROD_ACCOUNT_ID, PROD_REGION with your values
    npx cdk destroy --all -c prefix=stuXX-prod -c environment=prod -c account=PROD_ACCOUNT_ID -c region=PROD_REGION
    ```

---

## Congratulations!

You have successfully configured a multi-stage GitLab CI/CD pipeline with cross-account deployment to a Prod environment, including a manual approval step. You have also implemented resource prefixing using CDK context to ensure environment isolation and prevent naming collisions.