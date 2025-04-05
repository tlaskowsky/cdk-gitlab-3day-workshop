---
layout: default
---
# Lab 1: Foundation & CI/CD Bootstrapping

## Goal

Initialize your CDK project, define stacks for core resources (S3, SQS) and compute (EC2), connect them, add basic tagging, set up a simple GitLab CI/CD pipeline leveraging pre-configured credentials for deployment to Dev, and verify the basic S3 -> SQS -> EC2 logging flow.

## Environment

* You will work within your assigned GitLab group. Create a new project within this group for this lab series (e.g., `doc-pipeline-lab`).
* Your GitLab group has AWS credentials pre-configured, providing Admin access to a designated AWS account. Your CI/CD pipeline will automatically use these credentials.
* A GitLab Runner tagged `cdk` is available to run your pipeline jobs.
* You can use the GitLab Web UI (Repository -> Files, Web IDE) or clone the repository to use VS Code locally.

## Prerequisites

* Access to your GitLab group and project.
* **If using VS Code locally:**
    * Node.js (v18 or later recommended) and npm installed.
    * AWS CDK Toolkit installed (`npm install -g aws-cdk`).
    * Git installed and configured.
* Your AWS Account/Region must be bootstrapped for CDK: `cdk bootstrap aws://ACCOUNT-NUMBER/REGION`.
    > **Instructor Note:** Please clarify if this has been pre-run for the students or if they need to run it themselves using local credentials (which might differ from the GitLab CI credentials). Provide the correct Account/Region if needed.
* A pre-existing VPC in your target AWS account/region, tagged `Name=WorkshopVPC`.
    > **Instructor Note:** Confirm the exact tag key/value or VPC name students should use for the lookup.

---

## Step 1: Initialize CDK Project

1.  **Create Project:** In your GitLab group, create a new **blank project** (e.g., `doc-pipeline-lab`). Initialize it **with a README**.

2.  **Clone (if using VS Code):** Clone the new project repository to your local machine and navigate into the directory.
    ```bash
    git clone <your-gitlab-repo-url.git>
    cd <your-project-name>
    ```
    > **Note:** If using the GitLab Web IDE, you can skip the cloning step and open the terminal directly within the Web IDE.

3.  **Initialize CDK App (in VS Code Terminal or GitLab Web IDE Terminal):**
    Run the following command. It will ask if you want to overwrite files like `README.md`; type `y` and press Enter.
    ```bash
    cdk init app --language typescript
    ```

4.  **Review Structure:** Take a moment to look at the generated project structure:
    * `bin/`: Contains the entry point application file (`<your-project-name>.ts`).
    * `lib/`: Contains your stack definition files (an example stack is created initially).
    * `package.json`: Defines project dependencies and scripts.
    * `cdk.json`: Configures CDK behavior (we might modify this later).
    * `tsconfig.json`: TypeScript compiler options.

5.  **Install Dependencies:** The basic dependencies are included by `cdk init`, but ensure `aws-cdk-lib` and `constructs` are listed in your `package.json`. If needed, install them:
    ```bash
    npm install aws-cdk-lib constructs
    ```
    *(Usually `cdk init` handles this correctly)*

---

## Step 2: Define the Core Stack (S3 Bucket, SQS Queue)

1.  **Delete Example Stack:** Remove the sample stack file created by `cdk init`:
    ```bash
    rm lib/<your-project-name>-stack.ts
    ```
    *(Replace `<your-project-name>` with the actual filename, e.g., `doc-pipeline-lab-stack.ts`)*

2.  **Create `core-stack.ts`:** Create a new file named `lib/core-stack.ts`.

3.  **Add Code:** Paste the following TypeScript code into `lib/core-stack.ts`. The comments explain what each part does.

    ```typescript
    // lib/core-stack.ts
    import * as cdk from 'aws-cdk-lib';
    import { Construct } from 'constructs';
    import * as s3 from 'aws-cdk-lib/aws-s3';
    import * as sqs from 'aws-cdk-lib/aws-sqs';

    // This class defines our Core stack, containing non-compute resources like S3 and SQS.
    export class CoreStack extends cdk.Stack {
      // Public properties allow other stacks to access these resources in a type-safe way.
      public readonly bucket: s3.Bucket;
      public readonly queue: sqs.Queue;

      constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // --- S3 Bucket ---
        // Create the S3 bucket where documents will be uploaded.
        this.bucket = new s3.Bucket(this, 'DocumentInputBucket', {
          // For workshops, automatically delete the bucket and its contents when the stack is destroyed.
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          autoDeleteObjects: true,
          // Best Practices: Enable encryption, versioning, block public access, enforce SSL.
          encryption: s3.BucketEncryption.S3_MANAGED, // S3-managed keys
          versioned: true,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Secure default
          enforceSSL: true, // Require HTTPS
        });

        // --- SQS Queue ---
        // Create the SQS queue that will eventually receive notifications (or be polled).
        this.queue = new sqs.Queue(this, 'DocumentProcessingQueue', {
          // Best Practice: Encrypt messages at rest.
          encryption: sqs.QueueEncryption.SQS_MANAGED, // SQS-managed keys
          // We might configure visibility timeout or retention period later if needed.
          // We will add a Dead Letter Queue in a future lab for error handling.
        });

        // --- Stack Outputs ---
        // Useful for easily finding resource names/ARNs in the AWS console or for cross-stack references if not passing props.
        new cdk.CfnOutput(this, 'InputBucketName', {
          value: this.bucket.bucketName,
          description: 'Name of the S3 bucket for document uploads',
        });
        new cdk.CfnOutput(this, 'ProcessingQueueUrl', {
          value: this.queue.queueUrl,
          description: 'URL of the SQS queue for processing',
        });
        new cdk.CfnOutput(this, 'ProcessingQueueArn', {
          value: this.queue.queueArn,
          description: 'ARN of the SQS queue for processing',
        });
      }
    }
    ```

---

## Step 3: Define the Compute Stack (EC2 Instance)

1.  **Create `compute-stack.ts`:** Create a new file named `lib/compute-stack.ts`.

2.  **Add Code:** Paste the following TypeScript code. This stack requires the VPC and the SQS queue from `CoreStack` to be passed in via its properties (`props`).

    ```typescript
    // lib/compute-stack.ts
    import * as cdk from 'aws-cdk-lib';
    import { Construct } from 'constructs';
    import * as ec2 from 'aws-cdk-lib/aws-ec2';
    import * as iam from 'aws-cdk-lib/aws-iam';
    import * as sqs from 'aws-cdk-lib/aws-sqs'; // Needed for type hints

    // Define an interface for the properties this stack expects.
    // This provides type safety when creating the stack.
    export interface ComputeStackProps extends cdk.StackProps {
      vpc: ec2.IVpc; // Expects an object representing the VPC
      processingQueue: sqs.Queue; // Expects the queue object from CoreStack
    }

    export class ComputeStack extends cdk.Stack {
      constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);

        // --- IAM Role for EC2 ---
        // Define an IAM Role that the EC2 instance will assume.
        // This grants the instance permissions to interact with other AWS services.
        const ec2Role = new iam.Role(this, 'EC2InstanceRole', {
          assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'), // Allows EC2 service to assume this role
          // Attach AWS managed policies for common functionality.
          managedPolicies: [
            // Allows connecting to the instance via SSM Session Manager (more secure than SSH)
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
          ],
        });

        // Grant the EC2 role specific permission to consume messages from our SQS queue.
        props.processingQueue.grantConsumeMessages(ec2Role);
        // Later, we might grant S3 read permissions: props.inputBucket.grantRead(ec2Role);

        // --- EC2 Security Group ---
        // Define a firewall for the EC2 instance.
        const ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
          vpc: props.vpc, // Place the security group within our VPC
          description: 'Allow outbound traffic for EC2 instance',
          allowAllOutbound: true, // Allow the instance to connect to AWS services (SQS, APIs, yum updates)
          // No inbound rules needed if using SSM Session Manager.
        });

        // --- EC2 UserData ---
        // Define a script that runs when the EC2 instance first boots up.
        const userData = ec2.UserData.forLinux();

        // Add commands to install utilities and the AWS CLI v2.
        userData.addCommands(
          'sudo yum update -y', // Update OS packages
          'sudo yum install -y unzip jq', // Install utilities: unzip for AWS CLI, jq for parsing JSON
          'echo "Installing AWS CLI v2..."',
          'curl "[https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip](https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip)" -o "awscliv2.zip"',
          'unzip awscliv2.zip',
          'sudo ./aws/install', // Install AWS CLI
          'rm -rf aws awscliv2.zip', // Cleanup installer files
          'echo "AWS CLI installed successfully."'
        );

        // Add environment variables needed by the polling script (Queue URL, Region).
        // These are written to /etc/environment to be available system-wide for login shells.
        userData.addCommands(
          `echo "export QUEUE_URL=${props.processingQueue.queueUrl}" >> /etc/environment`,
          `echo "export AWS_REGION=${this.region}" >> /etc/environment`
        );

        // Add the polling script itself.
        userData.addCommands(
          'echo "Creating polling script..."',
          'echo "#!/bin/bash" > /home/ec2-user/poll_sqs.sh',
          'echo "source /etc/environment" >> /home/ec2-user/poll_sqs.sh', // Load env vars
          'echo "echo Polling SQS Queue: \${QUEUE_URL} in region \${AWS_REGION}" >> /home/ec2-user/poll_sqs.sh',
          // The core loop: receive messages, extract body using jq, log, wait, repeat.
          // Use the full path to aws binary just in case PATH is not set yet.
          'echo "while true; do /usr/local/bin/aws sqs receive-message --queue-url \${QUEUE_URL} --region \${AWS_REGION} --wait-time-seconds 10 --max-number-of-messages 1 | jq -r \'.Messages[] | (\\\"Received message ID: \\\" + .MessageId + \\\" Body: \\\" + .Body)\' >> /home/ec2-user/sqs_messages.log; sleep 5; done" >> /home/ec2-user/poll_sqs.sh',
          'chmod +x /home/ec2-user/poll_sqs.sh', // Make executable
          'echo "Polling script created."'
        );

        // Run the script in the background as the ec2-user.
        userData.addCommands(
          'echo "Starting polling script in background..."',
          'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"',
          'echo "UserData script finished."'
        );

        // --- EC2 Instance ---
        // Define the EC2 instance itself.
        const instance = new ec2.Instance(this, 'ProcessingInstance', {
          vpc: props.vpc, // Place instance in the imported VPC
          // Prefer private subnets if the VPC is configured with NAT Gateway/Endpoints for outbound access.
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO), // Specify instance size
          machineImage: ec2.MachineImage.latestAmazonLinux2023(), // Use latest Amazon Linux 2023 AMI
          securityGroup: ec2SecurityGroup, // Attach the security group
          role: ec2Role, // Attach the IAM role
          userData: userData, // Provide the startup script
        });

        // --- Stack Outputs ---
        new cdk.CfnOutput(this, 'InstanceId', {
          value: instance.instanceId,
          description: 'ID of the EC2 processing instance',
        });
      }
    }
    ```

---

## Step 4: Instantiate and Connect Stacks in the App

1.  **Open App Entrypoint:** Open the main application file `bin/<your-project-name>.ts`.

2.  **Modify Code:** Update the file to:
    * Import your new stacks (`CoreStack`, `ComputeStack`).
    * Look up the pre-existing VPC using tags.
    * Instantiate `CoreStack`.
    * Instantiate `ComputeStack`, passing the VPC object and the queue object from `CoreStack` via its `props`.

    ```typescript
    #!/usr/bin/env node
    import 'source-map-support/register';
    import * as cdk from 'aws-cdk-lib';
    import { CoreStack } from '../lib/core-stack'; // Import CoreStack
    import { ComputeStack } from '../lib/compute-stack'; // Import ComputeStack
    import * as ec2 from 'aws-cdk-lib/aws-ec2'; // Needed for Vpc lookup

    const app = new cdk.App();

    // --- Define Deployment Environment ---
    // Use AWS environment variables provided by GitLab CI or local AWS profile.
    // Ensure your AWS account and region are correctly configured where you run CDK commands.
    const deploymentProps = {
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
        region: process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION,
      },
    };

    // Validate that environment variables are set
    if (!deploymentProps.env.region) {
      throw new Error("Region must be defined via CDK_DEFAULT_REGION or AWS_DEFAULT_REGION environment variables");
    }
    if (!deploymentProps.env.account) {
      throw new Error("Account must be defined via CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variables");
    }
    console.log(`Targeting AWS Account: ${deploymentProps.env.account} Region: ${deploymentProps.env.region}`);


    // --- Look up Existing VPC ---
    // Use Vpc.fromLookup to find the VPC based on tags.
    // Make sure the tags match your workshop environment's VPC.
    console.log('Looking up VPC with tag Name=WorkshopVPC...');
    const vpc = ec2.Vpc.fromLookup(app, 'ImportedVpc', {
      tags: { Name: 'WorkshopVPC' }, // Adjust this tag key/value if needed!
      isDefault: false, // Explicitly state we don't want the default VPC unless intended
    });
    console.log(`Found VPC: ${vpc.vpcId}`);

    // --- Instantiate Stacks ---
    // Create an instance of the CoreStack.
    console.log('Instantiating CoreStack...');
    const coreStack = new CoreStack(app, 'CoreStack', deploymentProps);

    // Create an instance of the ComputeStack.
    // Pass the necessary props: the deployment environment, the looked-up VPC,
    // and the queue resource directly from the coreStack instance.
    console.log('Instantiating ComputeStack...');
    const computeStack = new ComputeStack(app, 'ComputeStack', {
      ...deploymentProps, // Spread the common env props
      vpc: vpc, // Pass the VPC object
      processingQueue: coreStack.queue, // Pass the queue object (cross-stack reference!)
    });

    // --- Add Stack Dependency (Optional) ---
    // Explicitly state that ComputeStack depends on CoreStack.
    // CDK often infers this, but it can be good practice for clarity.
    computeStack.addDependency(coreStack);
    console.log('Stacks instantiated.');
    ```

---

## Step 5: Implement Basic Tagging with Aspects

1.  **Create `tagging-aspect.ts`:** Create a new file named `lib/tagging-aspect.ts`.

2.  **Add Code:** Paste the following `BasicTagger` class definition. This class implements the `IAspect` interface required by CDK Aspects.

    ```typescript
    // lib/tagging-aspect.ts
    import * as cdk from 'aws-cdk-lib';
    import { IConstruct } from 'constructs';

    // This Aspect applies a specified tag key/value pair to all taggable resources within its scope.
    export class BasicTagger implements cdk.IAspect {
      private readonly key: string;
      private readonly value: string;

      constructor(key: string, value: string) {
        this.key = key;
        this.value = value;
      }

      // This method is called for every Construct in the scope (App, Stack, etc.)
      public visit(node: IConstruct): void {
        // The TagManager utility checks if the resource supports tags.
        if (cdk.TagManager.isTaggable(node)) {
          // Apply the tag using the 'tags' property available on taggable constructs.
          node.tags.setTag(this.key, this.value);
        }
      }
    }
    ```

3.  **Apply Aspect:** Open `bin/<your-project-name>.ts` again.

4.  **Add Code:** At the *end* of the file, after the stacks are instantiated, import and apply the `BasicTagger` aspect to the entire application scope (`app`).

    ```typescript
    // bin/<your-project-name>.ts
    // ... (previous imports and stack instantiation code) ...

    // --- Import the Tagger Aspect ---
    import { BasicTagger } from '../lib/tagging-aspect';

    // --- Apply Aspects ---
    // Apply tags globally to all taggable resources created within the 'app' scope.
    console.log('Applying aspects for tagging...');
    cdk.Aspects.of(app).add(new BasicTagger('environment', 'dev'));
    cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
    // Example: You could potentially use GitLab CI predefined variables for dynamic tags
    // if (process.env.CI_PROJECT_PATH) {
    //   cdk.Aspects.of(app).add(new BasicTagger('gitlab-project', process.env.CI_PROJECT_PATH));
    // }
    console.log('Tagging aspects applied.');
    ```

---

## Step 6: Set up GitLab CI/CD

1.  **Create `.gitlab-ci.yml`:** In the **root** of your project repository, create (or edit) the file named `.gitlab-ci.yml`.

2.  **Add Code:** Paste the following YAML pipeline definition. It defines stages, jobs, uses the specified `cdk` runner tag, and leverages the GitLab group's pre-configured AWS credentials.

    ```yaml
    # .gitlab-ci.yml

    # Define the sequence of execution stages for the pipeline
    stages:
      - validate     # Quick checks (like AWS connectivity)
      - build        # Compile code, synthesize CDK template
      - deploy-dev   # Deploy the application to the 'dev' environment

    # Define variables accessible in all jobs
    variables:
      NODE_VERSION: "18" # Specify the Node.js version for consistency
      # AWS_DEFAULT_REGION: "us-east-1" # Optional: Override if needed, otherwise uses GitLab/Runner config

    # Default settings applied to all jobs unless overridden
    default:
      tags: [cdk] # **Crucial:** Ensures jobs run on the designated GitLab Runner

    # Job to verify AWS connectivity using the runner's configured credentials
    validate_aws_connection:
      stage: validate
      image:
        name: amazon/aws-cli:latest # Use official AWS CLI image for reliability
        entrypoint: [""]           # Override default entrypoint
      tags: [cdk] # Explicitly tag, although default should cover it
      script:
        - echo "Verifying AWS connection using automatically provided GitLab credentials..."
        - aws sts get-caller-identity # Simple AWS command to check authentication
        - echo "AWS connection verified successfully."
      rules: # Control when this job runs
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH' # Run only on pushes/merges to the default branch

    # Job to build the CDK application
    build_cdk:
      stage: build
      image: node:${NODE_VERSION} # Use the specified Node.js version
      tags: [cdk]
      cache: # Cache dependencies to speed up subsequent builds
        key:
          files: [package-lock.json] # Use lock file for cache key consistency
        paths: [node_modules/]    # Cache the node_modules directory
      script:
        - echo "Installing dependencies using npm ci..."
        - npm ci # Use 'ci' for clean, consistent installs in CI environments
        - echo "Building TypeScript code..."
        - npm run build # Runs 'tsc' as defined in package.json
        - echo "Synthesizing CloudFormation template..."
        # Use 'npx' to run the CDK toolkit installed as a dev dependency
        - npx cdk synth --all
      artifacts: # Save the synthesized templates for the deploy job
        paths: [cdk.out/]
        expire_in: 1 hour # Keep artifacts for a limited time
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    # Job to deploy the CDK application to the Dev environment
    deploy_to_dev:
      stage: deploy-dev
      image: node:${NODE_VERSION} # Needs Node.js and access to CDK (via node_modules)
      tags: [cdk]
      needs: [build_cdk] # Ensure build_cdk job completes successfully first
      dependencies: [build_cdk] # Download artifacts (cdk.out) from build_cdk job
      script:
        # Credentials are automatically injected by GitLab from the group/project settings.
        # The AWS Region is expected to be configured in the runner or GitLab variables.
        - echo "Deploying stacks to Dev environment (Region: ${AWS_DEFAULT_REGION:-check_runner_config})..."
        # Use 'npx' to run the CDK toolkit from local node_modules.
        # '--all' deploys all stacks defined in the app.
        # '--require-approval never' skips manual confirmation (use cautiously).
        # '--outputs-file' saves stack outputs to a JSON file.
        - npx cdk deploy --all --require-approval never --outputs-file cdk-outputs.json
        - echo "Deployment complete."
      environment: # Define a GitLab environment for tracking deployments
        name: dev
        # url: $YOUR_APP_URL # Optional: Add URL if app has one later
      artifacts: # Save the deployment outputs file
        paths: [cdk-outputs.json]
        expire_in: 1 day
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
    ```

---

## Step 7: Deploy and Verify

1.  **Commit and Push Code:**
    * **Using GitLab Web UI:** Navigate to `Repository -> Files`, review your changes, and commit them to the default branch (`main` or `master`).
    * **Using VS Code:** Stage, commit, and push your changes using the Git command line.
        ```bash
        # Check which files have changed
        git status

        # Stage all changes
        git add .

        # Commit the changes with a descriptive message
        git commit -m "Lab 1: Implement Core/Compute stacks and basic CI/CD"

        # Push the changes to your GitLab repository's default branch
        git push origin main # Or 'master', depending on your default branch name
        ```

2.  **Monitor GitLab Pipeline:**
    * Navigate to your project's `Build -> Pipelines` section in GitLab.
    * A new pipeline should appear and start running automatically.
    * Click on the pipeline status icon to see the stages and jobs (`validate_aws_connection`, `build_cdk`, `deploy_to_dev`).
    * Observe the job progress. If a job fails, click on it to view the detailed log output to diagnose the error. The `validate` job should pass quickly if credentials are correct. The `build` job compiles and synthesizes. The `deploy` job interacts with AWS CloudFormation.

3.  **Check AWS CloudFormation:**
    * Once the `deploy_to_dev` job in GitLab shows "passed", navigate to the **AWS CloudFormation console** in the AWS region targeted by your deployment (check `AWS_DEFAULT_REGION` used by the pipeline).
    * You should see two stacks listed: `CoreStack` and `ComputeStack`. Their status should be `CREATE_COMPLETE`.

4.  **Verify AWS Resources:**
    * Go to the **S3 console**: Find the bucket named similar to `corestack-documentinputbucket-xxxx`.
    * Go to the **SQS console**: Find the queue named similar to `corestack-documentprocessingqueue-xxxx`.
    * Go to the **EC2 console**: Find the instance named `ProcessingInstance`. Verify its "Instance state" is "Running". Note its **Instance ID**.

5.  **Test the EC2 Polling Logic:**
    * **Send Manual SQS Message:** In the SQS console, select your queue. Click the **"Send and receive messages"** button. In the "Message body" field, enter a simple JSON message like `{"test": "Hello from console", "file": "manual_test.txt"}`. Click **"Send message"**.
    * **Connect to EC2 Instance:** In the EC2 console, select your `ProcessingInstance`. Click the **"Connect"** button. Choose the **"Session Manager"** tab (this is the recommended, secure way). Click **"Connect"**. This should open a terminal session in your browser.
    * **Check Logs:** Once connected to the EC2 instance's terminal, use the `tail` command to watch the log file created by your UserData script:
        ```bash
        tail -f /home/ec2-user/sqs_messages.log
        ```
    * **Observe Output:** Within approximately 15-20 seconds (allowing for the SQS `WaitTimeSeconds` and the script's `sleep` interval), you should see output similar to this appear in the terminal:
        `Received message ID: <some-long-message-id> Body: {"test": "Hello from console", "file": "manual_test.txt"}`

---

## Congratulations!

You have successfully completed Lab 1!

* You initialized a CDK project using TypeScript.
* You defined two stacks (`CoreStack`, `ComputeStack`) creating S3, SQS, and EC2 resources.
* You successfully looked up an existing VPC and used cross-stack references via props.
* You implemented basic tagging using CDK Aspects.
* You configured and ran a GitLab CI/CD pipeline that automatically deployed your infrastructure using pre-configured credentials.
* You verified that the EC2 instance can poll the SQS queue and log received messages.

In the next lab, you will enhance the CI/CD pipeline to support deployment to a second (Prod) AWS account and implement unique resource naming.