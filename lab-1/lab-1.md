# Lab 1: Foundation & CI/CD Bootstrapping

## Goal

Initialize your CDK project, define stacks for core resources (S3, SQS) and compute (EC2), connect them using the **pre-deployed VPC**, add basic tagging, set up a simple GitLab CI/CD pipeline (including bootstrapping) leveraging pre-configured credentials for deployment to Dev, and verify the basic S3 -> SQS -> EC2 logging flow.

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
* **VPC:** A VPC tagged `Name=WorkshopVPC` has been pre-deployed in your AWS account/region using the provided CloudFormation template. Your CDK application will look this VPC up using its tag.
* **CDK Bootstrap:** Your AWS Account/Region needs to be bootstrapped for CDK. This will be handled by the GitLab CI/CD pipeline you configure in Step 6. *(Note: For local `cdk synth` or `cdk diff` commands, you might still need to run `cdk bootstrap` locally using appropriate credentials, but it's not required for the CI/CD deployment).*

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
4.  **Review Structure:** Familiarize yourself with `bin/`, `lib/`, `package.json`, `cdk.json`.
5.  **Install Dependencies:** Ensure `aws-cdk-lib` and `constructs` are listed in your `package.json`. If needed, install them (usually `cdk init` handles this):
    ```bash
    npm install aws-cdk-lib constructs
    ```

---

## Step 2: Define the Core Stack (S3 Bucket, SQS Queue)

1.  **Delete Example Stack:** Remove the sample stack file created by `cdk init`:
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
2.  **Add Code:** Paste the following TypeScript code. This stack requires the VPC and the SQS queue.
    ```typescript
    // lib/compute-stack.ts
    import * as cdk from 'aws-cdk-lib';
    import { Construct } from 'constructs';
    import * as ec2 from 'aws-cdk-lib/aws-ec2';
    import * as iam from 'aws-cdk-lib/aws-iam';
    import * as sqs from 'aws-cdk-lib/aws-sqs';

    export interface ComputeStackProps extends cdk.StackProps {
      vpc: ec2.IVpc; // Expects the VPC object
      processingQueue: sqs.Queue; // Expects the queue object
    }

    export class ComputeStack extends cdk.Stack {
      constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);

        // IAM Role for EC2 instance
        const ec2Role = new iam.Role(this, 'EC2InstanceRole', {
          assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
          ],
        });
        props.processingQueue.grantConsumeMessages(ec2Role); // Grant SQS permissions

        // Security Group for EC2 instance
        const ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
          vpc: props.vpc,
          description: 'Security group for the document processing EC2 instance',
          allowAllOutbound: true, // Allow outbound connections
        });

        // UserData script for instance setup and polling
        const userData = ec2.UserData.forLinux();
        userData.addCommands(
          'sudo yum update -y',
          'sudo yum install -y unzip jq', // Install utilities
          'echo "Installing AWS CLI v2..."', // Install AWS CLI v2
          'curl "[https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip](https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip)" -o "awscliv2.zip"',
          'unzip awscliv2.zip',
          'sudo ./aws/install',
          'rm -rf aws awscliv2.zip',
          'echo "AWS CLI installed successfully."',
          // Setup environment variables for the polling script
          `echo "export QUEUE_URL=${props.processingQueue.queueUrl}" >> /etc/environment`,
          `echo "export AWS_REGION=${this.region}" >> /etc/environment`,
          // Create the polling script
          'echo "Creating polling script..."',
          'echo "#!/bin/bash" > /home/ec2-user/poll_sqs.sh',
          'echo "source /etc/environment" >> /home/ec2-user/poll_sqs.sh',
          'echo "echo Polling SQS Queue: \${QUEUE_URL} in region \${AWS_REGION}" >> /home/ec2-user/poll_sqs.sh',
          'echo "while true; do /usr/local/bin/aws sqs receive-message --queue-url \${QUEUE_URL} --region \${AWS_REGION} --wait-time-seconds 10 --max-number-of-messages 1 | jq -r \'.Messages[] | (\\\"Received message ID: \\\" + .MessageId + \\\" Body: \\\" + .Body)\' >> /home/ec2-user/sqs_messages.log; sleep 5; done" >> /home/ec2-user/poll_sqs.sh',
          'chmod +x /home/ec2-user/poll_sqs.sh',
          'echo "Polling script created."',
          // Run the script in the background
          'echo "Starting polling script in background..."',
          'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"',
          'echo "UserData script finished."'
        );

        // EC2 Instance Definition
        const instance = new ec2.Instance(this, 'ProcessingInstance', {
          vpc: props.vpc, // Use the VPC passed in props
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // Place in private subnet
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
          machineImage: ec2.MachineImage.latestAmazonLinux2023(),
          securityGroup: ec2SecurityGroup,
          role: ec2Role,
          userData: userData,
        });

        // Stack Output
        new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
      }
    }
    ```

---

## Step 4: Instantiate and Connect Stacks in the App

1.  **Open App Entrypoint:** Open the main application file `bin/<your-project-name>.ts`.
2.  **Modify Code:** Update the file to import your stacks, look up the **pre-deployed VPC using its tag**, and instantiate the stacks, passing the necessary resources via props.
    ```typescript
    #!/usr/bin/env node
    import 'source-map-support/register';
    import * as cdk from 'aws-cdk-lib';
    import { CoreStack } from '../lib/core-stack';
    import { ComputeStack } from '../lib/compute-stack';
    import * as ec2 from 'aws-cdk-lib/aws-ec2'; // Needed for Vpc lookup

    const app = new cdk.App();

    // Define Deployment Environment using variables expected to be set by GitLab CI
    const deploymentProps = {
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
        region: process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION,
      },
    };

    // Validate environment variables
    if (!deploymentProps.env.region) { throw new Error("Region environment variable not set"); }
    if (!deploymentProps.env.account) { throw new Error("Account environment variable not set"); }
    console.log(`Targeting AWS Account: ${deploymentProps.env.account} Region: ${deploymentProps.env.region}`);

    // --- Look up the Pre-Deployed VPC ---
    // This uses Vpc.fromLookup to find the VPC created by the instructor's CloudFormation template,
    // identifying it by the 'Name=WorkshopVPC' tag.
    console.log('Looking up pre-deployed VPC with tag Name=WorkshopVPC...');
    const vpc = ec2.Vpc.fromLookup(app, 'ImportedVpc', {
      tags: { Name: 'WorkshopVPC' }, // This tag MUST match the tag on the deployed VPC
      isDefault: false,
    });
    // If the lookup fails, CDK synth/deploy will throw an error.
    console.log(`Found VPC: ${vpc.vpcId}`);

    // --- Instantiate Stacks ---
    console.log('Instantiating CoreStack...');
    const coreStack = new CoreStack(app, 'CoreStack', deploymentProps);

    console.log('Instantiating ComputeStack...');
    const computeStack = new ComputeStack(app, 'ComputeStack', {
      ...deploymentProps,
      vpc: vpc, // Pass the looked-up VPC object
      processingQueue: coreStack.queue, // Pass the queue from CoreStack
    });

    // Add Stack Dependency (optional, often inferred)
    computeStack.addDependency(coreStack);
    console.log('Stacks instantiated.');
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
4.  **Add Code:** At the *end* of the file, import and apply the `BasicTagger` aspect.
    ```typescript
    // bin/<your-project-name>.ts
    // ... (previous imports and stack instantiation code) ...
    import { BasicTagger } from '../lib/tagging-aspect';

    // ... (app, deploymentProps, vpc, coreStack, computeStack instantiation) ...

    // Apply tags globally
    console.log('Applying aspects for tagging...');
    cdk.Aspects.of(app).add(new BasicTagger('environment', 'dev'));
    cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
    console.log('Tagging aspects applied.');
    ```

---

## Step 6: Set up GitLab CI/CD (Includes Bootstrap)

1.  **Create `.gitlab-ci.yml`:** In the **root** of your project repository, create/edit the file named `.gitlab-ci.yml`.
2.  **Add Code:** Paste the following pipeline definition. It includes a stage to run `cdk bootstrap`.
    ```yaml
    # .gitlab-ci.yml

    stages:
      - bootstrap    # New stage for CDK bootstrapping
      - validate     # Quick checks (like AWS connectivity)
      - build        # Compile code, synthesize CDK template
      - deploy-dev   # Deploy the application to the 'dev' environment

    variables:
      NODE_VERSION: "18"

    default:
      tags: [cdk] # Ensures jobs run on the correct GitLab Runner

    bootstrap_dev:
      stage: bootstrap
      image: node:${NODE_VERSION}
      tags: [cdk]
      script:
        - echo "Bootstrapping Dev environment (Region: ${AWS_DEFAULT_REGION:-check_runner_config})..."
        - npm install -g aws-cdk # Install CDK CLI
        # Use environment variables automatically provided by GitLab/Runner for account/region
        - cdk bootstrap "aws://${AWS_ACCOUNT_ID}/${AWS_DEFAULT_REGION}" --require-approval never
        - echo "Bootstrap complete for Dev environment."
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    validate_aws_connection:
      stage: validate
      image: name: amazon/aws-cli:latest
             entrypoint: [""]
      tags: [cdk]
      script:
        - echo "Verifying AWS connection using automatically provided GitLab credentials..."
        - aws sts get-caller-identity
        - echo "AWS connection verified successfully."
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    build_cdk:
      stage: build
      image: node:${NODE_VERSION}
      tags: [cdk]
      cache:
        key: { files: [package-lock.json] }
        paths: [node_modules/]
      script:
        - echo "Installing dependencies using npm ci..."
        - npm ci
        - echo "Building TypeScript code..."
        - npm run build
        - echo "Synthesizing CloudFormation template..."
        - npx cdk synth --all
      artifacts:
        paths: [cdk.out/]
        expire_in: 1 hour
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    deploy_to_dev:
      stage: deploy-dev
      image: node:${NODE_VERSION}
      tags: [cdk]
      needs:
        - job: bootstrap_dev
          optional: true # Allow pipeline to proceed if bootstrap fails (e.g., already done)
        - job: build_cdk
      dependencies: [build_cdk]
      script:
        - echo "Deploying stacks to Dev environment (Region: ${AWS_DEFAULT_REGION:-check_runner_config})..."
        - npx cdk deploy --all --require-approval never --outputs-file cdk-outputs.json
        - echo "Deployment complete."
      environment: { name: dev }
      artifacts:
        paths: [cdk-outputs.json]
        expire_in: 1 day
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
    ```

---

## Step 7: Deploy and Verify

1.  **Commit and Push Code:**
    * **Using GitLab Web UI:** Commit the changes.
    * **Using VS Code:** Stage, commit, and push your changes.
        ```bash
        git add .
        git commit -m "Lab 1: Implement Core/Compute stacks and basic CI/CD"
        git push origin main # Or master
        ```

2.  **Monitor GitLab Pipeline:**
    * Go to your project's `Build -> Pipelines` section. The pipeline should start.
    * Observe the stages: `bootstrap`, `validate`, `build`, `deploy-dev`.
    * Check job logs, especially for the `bootstrap_dev` and `deploy_to_dev` jobs.

3.  **Check AWS CloudFormation:**
    * Once `deploy_to_dev` succeeds, go to the AWS CloudFormation console.
    * Verify the `CDKToolkit` stack exists (from bootstrap).
    * Verify the `CoreStack` and `ComputeStack` are in `CREATE_COMPLETE` status.

4.  **Verify AWS Resources:**
    * Check S3, SQS, and EC2 consoles for your bucket, queue, and instance. Note the **Instance ID**.

5.  **Test the EC2 Polling Logic:**
    * **Send Manual SQS Message:** Go to SQS Console -> Your queue -> Send and receive messages -> Enter `{"test": "Hello from console", "source": "manual"}` -> Send message.
    * **Connect to EC2 Instance:** Go to EC2 Console -> Instances -> Select your instance -> Connect -> **Session Manager** -> Connect.
    * **Check Logs:** In the EC2 terminal session:
        ```bash
        tail -f /home/ec2-user/sqs_messages.log
        ```
    * **Observe Output:** You should see your test message logged within ~20 seconds.

---

## Congratulations!

You have successfully completed Lab 1 using the pre-deployed VPC! You've set up the core application stacks, configured CI/CD including bootstrap, and verified the basic compute logic.