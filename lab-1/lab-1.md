---
layout: default
title: Lab 1 Hands-on Instructions
nav_order: 11
has_children: true
---

# Lab 1: Foundation & CI/CD Bootstrapping

## Goal

Initialize your CDK project, define stacks for core resources (S3, SQS) and compute (EC2), connect them using the **pre-deployed VPC**, add basic tagging, set up a simple GitLab CI/CD pipeline (including bootstrapping) leveraging pre-configured credentials for deployment to Dev, and verify the basic S3 -> SQS -> EC2 logging flow.

## Environment

* You will work within your assigned GitLab group. Create a new project within this group for this lab series (e.g., `doc-pipeline-lab`).
* Your GitLab group has AWS credentials pre-configured, providing Admin access to a designated AWS account. Your CI/CD pipeline will automatically use these credentials.
* A GitLab Runner tagged `cdk` is available to run your pipeline jobs.
* You will need a local environment (like VS Code with a terminal) to initialize the CDK project. Subsequent edits can be made locally or via the GitLab Web UI/IDE.

## Prerequisites

* Access to your GitLab group and project.
* **Local Development Environment:**
    * Node.js (v18 or later recommended) and npm installed.
    * AWS CDK Toolkit installed (`npm install -g aws-cdk`).
    * Git installed and configured.
* **VPC:** A VPC tagged `Name=WorkshopVPC` has been pre-deployed in your AWS account/region using the provided CloudFormation template. Your CDK application will look this VPC up using its tag.
* **CDK Bootstrap:** Your AWS Account/Region needs to be bootstrapped for CDK. This will be handled by the GitLab CI/CD pipeline you configure in Step 6. *(Note: For local `cdk synth` or `cdk diff` commands, you might still need to run `cdk bootstrap` locally using appropriate credentials, but it's not required for the CI/CD deployment).*

---

## Step 1: Initialize CDK Project

1.  **Create Blank Project:** In your GitLab group, create a new **blank project** (e.g., `doc-pipeline-lab`). Initialize it **with without a README**. Do **not** add templates like `.gitignore` or `LICENSE` yet, as `cdk init` will provide some.
2.  **Clone Locally:**
    * Navigate to your newly created project's main page in the GitLab UI.
    * Click the blue **"Code"** button (usually near the top right).
    * Copy the URL provided under **"Clone with HTTPS"**. It will look something like `https://gitlab.com/your-group/your-project.git`.
    * In your **local terminal**, use the copied URL with the `git clone` command. Then navigate into the newly created project directory. Replace `PASTE_HTTPS_URL_HERE` with the URL you copied.
        ```bash
        git clone PASTE_HTTPS_URL_HERE
        cd <your-project-name> # The directory name usually matches your project name
        ```
3.  **Initialize CDK App Locally:** Run the `cdk init` command in your **local terminal** within the cloned project directory. This command requires Node.js and the CDK Toolkit to be installed locally.
    ```bash
    cdk init app --language typescript
    ```
    > **Note:** This command populates your local directory with the necessary CDK project structure and files (including `.gitignore`, `package.json`, etc.). It might ask to overwrite the `README.md`; you can allow this.
4.  **Review Structure:** Familiarize yourself locally with the generated `bin/`, `lib/`, `package.json`, `cdk.json`, `.gitignore` files.
5.  **Install Dependencies (Locally):** Although `cdk init` usually runs `npm install`, it's good practice to ensure dependencies are installed locally.
    ```bash
    npm install
    ```
6.  **Commit Initial Project:** Stage, commit, and push the CDK-generated project structure to your GitLab repository. This makes the base project available in GitLab for the CI/CD pipeline.
    ```bash
    git add .
    git commit -m "Initial project structure from cdk init"
    git push origin main # Or master
    ```
    > After this initial push, you can choose to continue working locally with VS Code or use the GitLab Web UI/IDE for subsequent file edits, committing changes as you go.

---

## Step 2: Define the Core Stack (S3 Bucket, SQS Queue)

1.  **Delete Example Stack:** Remove the sample stack file created by `cdk init` (either locally or via GitLab UI):
    ```bash
    # Replace <your-project-name> with the actual filename
    rm lib/<your-project-name>-stack.ts
    ```
2.  **Create `core-stack.ts`:** Create a new file named `lib/core-stack.ts`.
3.  **Add Code:** Paste the following TypeScript code into `lib/core-stack.ts`.
    ```typescript
    // lib/core-stack.ts
    import * as cdk from 'aws-cdk-lib';
    import { Construct } from 'constructs';
    import * as s3 from 'aws-cdk-lib/aws-s3';
    import * as sqs from 'aws-cdk-lib/aws-sqs';

    export class CoreStack extends cdk.Stack {
      public readonly bucket: s3.Bucket;
      public readonly queue: sqs.Queue;

      constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // S3 bucket for document uploads
        this.bucket = new s3.Bucket(this, 'DocumentInputBucket', {
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          autoDeleteObjects: true,
          encryption: s3.BucketEncryption.S3_MANAGED,
          versioned: true,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          enforceSSL: true,
        });

        // SQS queue for processing tasks
        this.queue = new sqs.Queue(this, 'DocumentProcessingQueue', {
          encryption: sqs.QueueEncryption.SQS_MANAGED,
        });

        // Outputs for easy reference
        new cdk.CfnOutput(this, 'InputBucketName', { value: this.bucket.bucketName });
        new cdk.CfnOutput(this, 'ProcessingQueueUrl', { value: this.queue.queueUrl });
        new cdk.CfnOutput(this, 'ProcessingQueueArn', { value: this.queue.queueArn });
      }
    }
    ```

---

## Step 3: Define the Compute Stack (EC2 Instance)

1.  **Create `compute-stack.ts`:** Create a new file named `lib/compute-stack.ts`.
2.  **Add Code:** Paste the following TypeScript code.
    ```typescript
    // lib/compute-stack.ts
    import * as cdk from 'aws-cdk-lib';
    import { Construct } from 'constructs';
    import * as ec2 from 'aws-cdk-lib/aws-ec2';
    import * as iam from 'aws-cdk-lib/aws-iam';
    import * as sqs from 'aws-cdk-lib/aws-sqs';

    export interface ComputeStackProps extends cdk.StackProps {
      processingQueue: sqs.Queue;
    }

    export class ComputeStack extends cdk.Stack {
      constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);

        // --- Look up VPC ---
        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
          tags: { Name: 'WorkshopVPC' }, isDefault: false,
        });

        // --- IAM Role ---
        const ec2Role = new iam.Role(this, 'EC2InstanceRole', {
          assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
          ],
         });
        props.processingQueue.grantConsumeMessages(ec2Role);

        // --- Security Group ---
        const ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
          vpc: vpc,
          description: 'Security group for the document processing EC2 instance',
          allowAllOutbound: true,
        });

        // --- EC2 UserData (Writing script directly via heredoc) ---
        const userData = ec2.UserData.forLinux();

        // Define the script content using a template literal.
        // Ensure the echo command has its argument double-quoted.
        
        const pollingScript = `#!/bin/bash
        echo "Polling SQS Queue: ${props.processingQueue.queueUrl} (Region determined automatically by AWS CLI)"
        while true; do
          # --- MODIFIED LINE BELOW: Use 'aws' directly, rely on PATH ---
          aws sqs receive-message --queue-url ${props.processingQueue.queueUrl} --wait-time-seconds 10 --max-number-of-messages 1 | \\
          # Parse with jq and append to log
          jq -r '.Messages[] | ("Received message ID: " + .MessageId + " Body: " + .Body)' >> /home/ec2-user/sqs_messages.log
          # Pause between polls
          sleep 5
        done`;

        // Add commands to UserData
        userData.addCommands(
          // Add dummy command to force updates if needed
          'echo "UserData Update Trigger: $(date)" > /home/ec2-user/userdata_trigger.log',
          // Install tools
          'sudo yum update -y',
          'sudo yum install -y unzip jq',
          'echo "Installing AWS CLI v2..."',
          'curl "[https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip](https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip)" -o "awscliv2.zip"',
          'unzip awscliv2.zip',
          'sudo ./aws/install',
          'rm -rf aws awscliv2.zip',
          'echo "AWS CLI installed successfully."',
          // Write the entire script using a heredoc
          'echo "Creating polling script..."',
          `cat <<'EOF' > /home/ec2-user/poll_sqs.sh
    ${pollingScript}
    EOF`,
          'chmod +x /home/ec2-user/poll_sqs.sh',
          // Ensure correct ownership
          'chown ec2-user:ec2-user /home/ec2-user/poll_sqs.sh',
          'touch /home/ec2-user/sqs_messages.log && chown ec2-user:ec2-user /home/ec2-user/sqs_messages.log',
          'touch /home/ec2-user/poll_sqs.out && chown ec2-user:ec2-user /home/ec2-user/poll_sqs.out',
          'touch /home/ec2-user/userdata_trigger.log && chown ec2-user:ec2-user /home/ec2-user/userdata_trigger.log',
          'echo "Polling script created."',
          // Run the script as ec2-user
          'echo "Starting polling script in background..."',
          'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"',
          'echo "UserData script finished."'
        );

        // --- EC2 Instance Definition (FORCE REPLACEMENT) ---
        // Keep forcing replacement for now until UserData is stable
        const instanceLogicalId = `ProcessingInstance-${Date.now()}`;
        const instance = new ec2.Instance(this, instanceLogicalId, { // Use dynamic logical ID
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.latestAmazonLinux2023(),
            securityGroup: ec2SecurityGroup,
            role: ec2Role,
            userData: userData, // Use the updated userData
        });

        // --- Stack Outputs ---
        new cdk.CfnOutput(this, 'InstanceIdOutput', { value: instance.instanceId });
        new cdk.CfnOutput(this, 'LookedUpVpcId', { value: vpc.vpcId });
      }
    }
    ```

---

## Step 4: Instantiate and Connect Stacks in the App

1.  **Open App Entrypoint:** Open the main application file `bin/<your-project-name>.ts`.
2.  **Modify Code:** Update the file to import your stacks and instantiate them, passing the necessary resources via props.
    ```typescript
    #!/usr/bin/env node
    import 'source-map-support/register';
    import * as cdk from 'aws-cdk-lib';
    import { CoreStack } from '../lib/core-stack';
    import { ComputeStack } from '../lib/compute-stack';
    import { BasicTagger } from '../lib/tagging-aspect'; // Import the aspect

    const app = new cdk.App();

    // --- Determine Target Account and Region ---
    const targetAccount = app.node.tryGetContext('account') ||
                          process.env.CDK_DEFAULT_ACCOUNT ||
                          process.env.AWS_ACCOUNT_ID;
    const targetRegion = app.node.tryGetContext('region') ||
                         process.env.CDK_DEFAULT_REGION ||
                         process.env.AWS_DEFAULT_REGION;

    // Validate environment variables
    if (!targetAccount) { throw new Error("Account environment variable not set"); }
    if (!targetRegion) { throw new Error("Region environment variable not set"); }
    console.log(`Targeting AWS Account: ${targetAccount} Region: ${targetRegion}`);

    const deploymentProps = {
      env: { account: targetAccount, region: targetRegion },
    };

    // --- Instantiate Stacks ---
    console.log('Instantiating CoreStack...');
    const coreStack = new CoreStack(app, 'CoreStack', deploymentProps);

    console.log('Instantiating ComputeStack...');
    // VPC lookup is now done inside ComputeStack
    const computeStack = new ComputeStack(app, 'ComputeStack', {
      ...deploymentProps,
      processingQueue: coreStack.queue,
    });
    // No need for explicit addDependency here

    console.log('Stacks instantiated.');

    // --- Apply Aspects ---
    console.log('Applying aspects for tagging...');
    cdk.Aspects.of(app).add(new BasicTagger('environment', 'dev'));
    cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
    console.log('Tagging aspects applied.');
    ```

---

## Step 5: Implement Basic Tagging with Aspects

1.  **Create `tagging-aspect.ts`:** Create a new file named `lib/tagging-aspect.ts`.
2.  **Add Code:** Paste the `BasicTagger` class definition.
    ```typescript
    // lib/tagging-aspect.ts
    import * as cdk from 'aws-cdk-lib';
    import { IConstruct } from 'constructs';

    export class BasicTagger implements cdk.IAspect {
      private readonly key: string;
      private readonly value: string;
      constructor(key: string, value: string) { this.key = key; this.value = value; }
      public visit(node: IConstruct): void {
        if (cdk.TagManager.isTaggable(node)) { node.tags.setTag(this.key, this.value); }
      }
    }
    ```
3.  **Apply Aspect:** Open `bin/<your-project-name>.ts` again.
4.  **Add Code:** Ensure the import and `cdk.Aspects.of(app).add(...)` calls are present at the end of the file (as shown in the Step 4 code block).

---

## Step 6: Set up GitLab CI/CD (Includes Bootstrap)

1.  **Create `.gitlab-ci.yml`:** In the **root** of your project repository, create/edit the file named `.gitlab-ci.yml`.
2.  **Add Code:** Paste the following pipeline definition.
    ```yaml
    # .gitlab-ci.yml (Consistent Conventional Key Order)

    stages:
      - bootstrap
      - validate
      - build
      - deploy-dev

    variables:
      NODE_VERSION: "18"

    default:
      tags: [cdk]

    bootstrap_dev:
      stage: bootstrap
      image: node:${NODE_VERSION}
      tags: [cdk]
      cache: # Setup keys first
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
        echo "Bootstrapping Dev environment (Region: ${AWS_DEFAULT_REGION:-check_runner_config})..."
        if [ -z "$AWS_ACCOUNT_ID" ] || [ -z "$AWS_DEFAULT_REGION" ]; then
          echo "Error: AWS_ACCOUNT_ID or AWS_DEFAULT_REGION is not set."
          exit 1
        fi
        npx cdk bootstrap "aws://${AWS_ACCOUNT_ID}/${AWS_DEFAULT_REGION}" \
          --require-approval never \
          -c account=${AWS_ACCOUNT_ID} \
          -c region=${AWS_DEFAULT_REGION}
        echo "Bootstrap complete for Dev environment."
      # No artifacts
      # No environment
      rules: # Control keys last
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    validate_aws_connection:
      stage: validate
      image:
        name: amazon/aws-cli:latest
        entrypoint: [""]
      tags: [cdk]
      # No cache
      # No needs
      # No dependencies
      script: # Script block (kept list format for simple script)
        - echo "Verifying AWS connection..."
        - aws sts get-caller-identity
        - echo "AWS connection verified."
      # No artifacts
      # No environment
      rules: # Control keys last
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    build_cdk:
      stage: build
      image: node:${NODE_VERSION}
      tags: [cdk]
      cache: # Setup keys first
        key:
          files:
            - package-lock.json
        paths:
          - node_modules/
      # No needs
      # No dependencies
      script: | # Script block
        echo "Installing dependencies..."
        npm ci
        echo "Building TypeScript code..."
        npm run build
        echo "Synthesizing CloudFormation template..."
        if [ -z "$AWS_ACCOUNT_ID" ] || [ -z "$AWS_DEFAULT_REGION" ]; then
          echo "Error: AWS_ACCOUNT_ID or AWS_DEFAULT_REGION is not set."
          exit 1
        fi
        npx cdk synth --all \
          -c account=${AWS_ACCOUNT_ID} \
          -c region=${AWS_DEFAULT_REGION}
      artifacts: # Post-execution keys
        paths: [cdk.out/]
        expire_in: 1 hour
      # No environment
      rules: # Control keys last
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    deploy_to_dev:
      stage: deploy-dev
      image: node:${NODE_VERSION}
      tags: [cdk]
      cache: # Setup keys first
        key:
          files:
            - package-lock.json
        paths:
          - node_modules/
        policy: pull
      needs: # Setup keys first
        - job: build_cdk
        - job: bootstrap_dev
          optional: true
      dependencies: # Setup keys first
        - build_cdk
      script: | # Script block
        echo "Installing dependencies for deploy job..."
        npm ci
        echo "Deploying stacks to Dev environment (Region: ${AWS_DEFAULT_REGION:-check_runner_config})..."
        if [ -z "$AWS_ACCOUNT_ID" ] || [ -z "$AWS_DEFAULT_REGION" ]; then
          echo "Error: AWS_ACCOUNT_ID or AWS_DEFAULT_REGION is not set."
          exit 1
        fi
        npx cdk deploy --all \
          --require-approval never \
          --outputs-file cdk-outputs.json \
          -c account=${AWS_ACCOUNT_ID} \
          -c region=${AWS_DEFAULT_REGION}
        echo "Deployment complete."
      artifacts: # Post-execution keys
        paths:
          - cdk-outputs.json
        expire_in: 1 day
      environment: # Post-execution keys
        name: dev
      rules: # Control keys last
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
    ```

---

## Step 7: Deploy and Verify

1.  **Commit and Push Code:**
    * **Using GitLab Web UI:** Commit the changes.
    * **Using VS Code:** Stage, commit, and push your changes.
        ```bash
        git add .
        git commit -m "Lab 1: Implement Core/Compute stacks and CI/CD"
        git push origin main # Or master
        ```
2.  **Monitor GitLab Pipeline:**
    * Go to your project's `Build -> Pipelines` section. The pipeline should start.
    * Observe the stages: `bootstrap`, `validate`, `build`, `deploy-dev`.
    * Check job logs for success.
3.  **Check AWS CloudFormation:**
    * Once `deploy_to_dev` succeeds, go to the AWS CloudFormation console.
    * Verify the `CDKToolkit` stack exists (from bootstrap).
    * Verify the `CoreStack` and `ComputeStack` are in `CREATE_COMPLETE` or `UPDATE_COMPLETE` status.
4.  **Verify AWS Resources:**
    * Check S3, SQS, and EC2 consoles for your bucket, queue, and instance. Note the **Instance ID** (it will likely have changed).
5.  **Test the EC2 Polling Logic:**
    * **Send Manual SQS Message:** Go to SQS Console -> Your queue -> Send and receive messages -> Enter `{"test": "Final test!", "source": "manual"}` -> Send message.
    * **Connect to EC2 Instance:** Go to EC2 Console -> Instances -> Select your *current* instance -> Connect -> **Session Manager** -> Connect.
    * **Check Logs:** In the EC2 terminal session:
        ```bash
        tail -f /home/ec2-user/sqs_messages.log
        ```
    * **Observe Output:** You should see your test message logged within ~20 seconds.

    * **>>> Understanding Repeated Messages <<<**
    * You might notice that if you leave `tail -f` running, the same message appears in the log repeatedly every ~30-40 seconds (depending on visibility timeout).
    * **Why?** Our current script only *receives* messages (`aws sqs receive-message`), it doesn't *delete* them. When SQS delivers a message, it makes it invisible for a "Visibility Timeout". If the message isn't deleted within that time, it becomes visible again for another consumer (or our looping script) to pick up.
    * **Is this expected?** Yes, for this simple Lab 1 script, this behavior is expected. In later labs involving actual processing, we would add a step to delete the message after successful processing to prevent this.

---
## Step 8: Clean Up Lab 1 Resources

It's important to remove the AWS resources created during this lab to avoid unnecessary charges. Since we deployed using CDK, we can use CDK to destroy the resources.

1.  **Configure Local AWS Credentials:** Ensure your **local terminal** has AWS credentials configured for the **Dev** account and region where you deployed the stacks. You can typically configure this using `aws configure` with appropriate Access Keys or by setting environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_DEFAULT_REGION`).
2.  **Navigate to Project Directory:** Open your local terminal and navigate to your CDK project directory (where your `cdk.json` file is located).
3.  **Run CDK Destroy:** Execute the destroy command. You will need to pass the same context variables used for deployment because your app code requires them for validation and lookups. Replace `YOUR_ACCOUNT_ID` and `YOUR_REGION` with the correct values for your Dev environment if they are not set in your default AWS profile or environment variables.
    ```bash
    # Example destroy command - adjust account/region as needed for your Dev env
    # npx cdk destroy --all -c account=YOUR_ACCOUNT_ID -c region=YOUR_REGION

    # If you have set the aws credentials using `aws configure`, then just use below
    npx cdk destroy --all
    ```
    * `--all`: Destroys all stacks defined in your CDK app (`CoreStack`, `ComputeStack`).
    * `-c ...`: Provides the necessary context for account and region lookup/validation within the app code.
4.  **Confirm Deletion:** CDK will show you the resources it plans to delete and ask for confirmation. Type `y` and press Enter.
5.  **Monitor Deletion:** Watch the output in your terminal and check the AWS CloudFormation console. The `CoreStack` and `ComputeStack` should eventually transition to a `DELETE_COMPLETE` status.

    > **Note:**
    > * `cdk destroy` will **not** delete the pre-existing VPC (as it wasn't created by these stacks).
    > * `cdk destroy` will **not** delete the `CDKToolkit` stack created by `cdk bootstrap`. This stack contains resources needed by CDK for deployments and can usually be left in the account.
    > * The S3 bucket (`DocumentInputBucket`) should be deleted automatically because we set `removalPolicy: cdk.RemovalPolicy.DESTROY` and `autoDeleteObjects: true`. If `autoDeleteObjects` was false or failed, you might need to manually empty and delete the bucket first before the stack can be deleted.

---

## Congratulations!

You have successfully completed Lab 1 using the pre-deployed VPC! You've set up the core application stacks, configured CI/CD including bootstrap, verified the basic compute logic, and understand why messages might repeat in the current setup.