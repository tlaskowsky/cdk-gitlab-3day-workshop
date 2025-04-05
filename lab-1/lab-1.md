Okay, thank you for clarifying the student environment and providing the working CI/CD snippet. That's very helpful! Knowing credentials are pre-configured at the group level and that there's a specific runner tag (`cdk`) simplifies things considerably.

Let's refine the Lab 1 materials incorporating these details.

---

### Part 1: Instructor Lecture Slides Content (Outline)

*(No major changes needed here based on the environment details, but the instructor should verbally mention the GitLab group setup, pre-configured AWS credentials, and the choice of Web UI/VS Code during the introduction or Lab Setup slides.)*

**Potential additions/notes for instructor:**

* **(During Intro/Setup):** "You'll each work within your own GitLab group where AWS credentials and necessary defaults are already set up for you. Your pipelines will use a specific runner tagged 'cdk'."
* **(During GitLab CI/CD Basics):** "Since credentials are pre-configured in your GitLab group, the runner automatically gets secure access to AWS – you won't need to manage keys in your CI/CD script."
* **(During Lab Intro):** "You can edit code using the GitLab Web UI directly or clone the repository and use VS Code with Git. If using VS Code, remember standard Git commands like `git add`, `git commit`, and `git push` to trigger your pipeline."

---

### Part 2: Step-by-Step Lab Instructions (Self-Directed - Revised)

**Lab 1: Foundation & CI/CD Bootstrapping**

**Goal:** Initialize your CDK project, define stacks for core resources (S3, SQS) and compute (EC2), connect them, add basic tagging, set up a simple GitLab CI/CD pipeline leveraging pre-configured credentials for deployment to Dev, and verify the basic S3 -> SQS -> EC2 logging flow.

**Environment:**

* You will work within your assigned GitLab group. Create a new project within this group for this lab series (e.g., `doc-pipeline-lab`).
* Your GitLab group has AWS credentials pre-configured, providing Admin access to a designated AWS account. Your CI/CD pipeline will automatically use these credentials.
* A GitLab Runner tagged `cdk` is available to run your pipeline jobs.
* You can use the GitLab Web UI (Repository -> Files, Web IDE) or clone the repository to use VS Code locally.

**Prerequisites:**

* Access to your GitLab group and project.
* **If using VS Code locally:**
    * Node.js (v18 or later recommended) and npm installed.
    * AWS CDK Toolkit installed (`npm install -g aws-cdk`).
    * Git installed and configured.
* Your AWS Account/Region must be bootstrapped for CDK: `cdk bootstrap aws://ACCOUNT-NUMBER/REGION`. Check with your instructor if this has been done or if you need to run it (requires local AWS credentials, potentially separate from GitLab's). *Instructor Note: Clarify bootstrap procedure.*
* A pre-existing VPC in your target AWS account/region, tagged `Name=WorkshopVPC` (or as specified by instructor).

**Step 1: Initialize CDK Project**

1.  **Create Project:** In your GitLab group, create a new blank project (e.g., `doc-pipeline-lab`). Initialize it with a README.
2.  **Clone (if using VS Code):** Clone the new project repository to your local machine.
    ```bash
    git clone <your-gitlab-repo-url.git>
    cd <your-project-name>
    ```
3.  **Initialize CDK App (in VS Code Terminal or GitLab Web IDE Terminal):**
    ```bash
    cdk init app --language typescript
    ```
    *(This will overwrite the initial README, which is fine)*
4.  **Review Structure:** Familiarize yourself with `bin/`, `lib/`, `package.json`, `cdk.json`.
5.  **Install Dependencies:**
    ```bash
    npm install aws-cdk-lib constructs
    ```

**Step 2: Define the Core Stack (S3 Bucket, SQS Queue)**

1.  Delete the example stack file (`lib/<your-project-name>-stack.ts`).
2.  Create `lib/core-stack.ts`.
3.  **Add Code:** Paste the following content. (Comments explain the code).
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
          removalPolicy: cdk.RemovalPolicy.DESTROY, // For workshop cleanup
          autoDeleteObjects: true,                  // For workshop cleanup
          encryption: s3.BucketEncryption.S3_MANAGED,
          versioned: true,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          enforceSSL: true,
        });

        // SQS queue for processing tasks
        this.queue = new sqs.Queue(this, 'DocumentProcessingQueue', {
          encryption: sqs.QueueEncryption.SQS_MANAGED,
          // Consider adding Dead Letter Queue in later labs
        });

        // Outputs for easy reference
        new cdk.CfnOutput(this, 'InputBucketName', { value: this.bucket.bucketName });
        new cdk.CfnOutput(this, 'ProcessingQueueUrl', { value: this.queue.queueUrl });
        new cdk.CfnOutput(this, 'ProcessingQueueArn', { value: this.queue.queueArn });
      }
    }
    ```

**Step 3: Define the Compute Stack (EC2 Instance)**

1.  Create `lib/compute-stack.ts`.
2.  **Add Code:** Paste the following content. (This defines the EC2 instance, its role, security group, and startup script).

    ```typescript
    // lib/compute-stack.ts
    import * as cdk from 'aws-cdk-lib';
    import { Construct } from 'constructs';
    import * as ec2 from 'aws-cdk-lib/aws-ec2';
    import * as iam from 'aws-cdk-lib/aws-iam';
    import * as sqs from 'aws-cdk-lib/aws-sqs';
    import * as s3 from 'aws-cdk-lib/aws-s3'; // Only if needed by EC2 logic later

    export interface ComputeStackProps extends cdk.StackProps {
      vpc: ec2.IVpc;
      processingQueue: sqs.Queue;
      // inputBucket: s3.Bucket; // Pass if needed later
    }

    export class ComputeStack extends cdk.Stack {
      constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);

        // IAM Role for EC2
        const ec2Role = new iam.Role(this, 'EC2InstanceRole', {
          assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'), // For SSM access
          ],
        });
        props.processingQueue.grantConsumeMessages(ec2Role); // Grant SQS permissions

        // Security Group for EC2
        const ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
          vpc: props.vpc,
          description: 'Security group for the document processing EC2 instance',
          allowAllOutbound: true, // Allow instance to reach AWS services (SQS, etc.)
        });
        // Using SSM, no inbound SSH rule needed by default

        // UserData script for instance setup and polling
        const userData = ec2.UserData.forLinux();
        userData.addCommands(
          'sudo yum update -y',
          'sudo yum install -y unzip jq', // Utilities needed
          // Install AWS CLI v2
          'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"',
          'unzip awscliv2.zip',
          'sudo ./aws/install',
          'rm -rf aws awscliv2.zip',
          // Setup environment variables for the polling script
          `echo "export QUEUE_URL=${props.processingQueue.queueUrl}" >> /etc/environment`,
          `echo "export AWS_REGION=${this.region}" >> /etc/environment`,
          // Polling script
          'echo "#!/bin/bash" > /home/ec2-user/poll_sqs.sh',
          'echo "source /etc/environment" >> /home/ec2-user/poll_sqs.sh',
          'echo "echo Polling SQS Queue: \${QUEUE_URL} in region \${AWS_REGION}" >> /home/ec2-user/poll_sqs.sh',
          'echo "while true; do /usr/local/bin/aws sqs receive-message --queue-url \${QUEUE_URL} --region \${AWS_REGION} --wait-time-seconds 10 --max-number-of-messages 1 | jq -r \'.Messages[] | (\\\"Received message ID: \\\" + .MessageId + \\\" Body: \\\" + .Body)\' >> /home/ec2-user/sqs_messages.log; sleep 5; done" >> /home/ec2-user/poll_sqs.sh',
          'chmod +x /home/ec2-user/poll_sqs.sh',
          // Run script as ec2-user
          'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"'
        );

        // EC2 Instance Definition
        const instance = new ec2.Instance(this, 'ProcessingInstance', {
          vpc: props.vpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // Prefer private subnets if VPC is configured for it
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
          machineImage: ec2.MachineImage.latestAmazonLinux2023(), // Use AL2023
          securityGroup: ec2SecurityGroup,
          role: ec2Role,
          userData: userData,
        });

        new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
      }
    }
    ```
    *(Self-correction: Explicitly used `/usr/local/bin/aws` in polling script just in case path isn't set correctly early in boot.)*

**Step 4: Instantiate and Connect Stacks in the App**

1.  Open `bin/<your-project-name>.ts`.
2.  **Modify Code:** Update the file to import and instantiate your stacks, look up the VPC, and pass props.

    ```typescript
    #!/usr/bin/env node
    import 'source-map-support/register';
    import * as cdk from 'aws-cdk-lib';
    import { CoreStack } from '../lib/core-stack';
    import { ComputeStack } from '../lib/compute-stack';
    import * as ec2 from 'aws-cdk-lib/aws-ec2';

    const app = new cdk.App();

    // Define target AWS account/region using CDK context or environment variables
    // Your GitLab group likely pre-configures the region, but being explicit is safe.
    const deploymentProps = {
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID, // AWS_ACCOUNT_ID might be set by GitLab CI
        region: process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION, // Use pre-configured region
      },
    };

    // Check if region is defined, fail fast if not
    if (!deploymentProps.env.region) {
        throw new Error("Region must be defined via CDK_DEFAULT_REGION or AWS_DEFAULT_REGION environment variables");
    }
     if (!deploymentProps.env.account) {
        throw new Error("Account must be defined via CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variables");
    }


    // Look up the existing VPC using tags assumed to be set in the workshop environment
    const vpc = ec2.Vpc.fromLookup(app, 'ImportedVpc', {
      tags: { Name: 'WorkshopVPC' }, // Adjust tag if needed based on instructor info
      isDefault: false,
    });

    // Instantiate Core Stack
    const coreStack = new CoreStack(app, 'CoreStack', deploymentProps);

    // Instantiate Compute Stack, passing VPC and CoreStack resources
    const computeStack = new ComputeStack(app, 'ComputeStack', {
      ...deploymentProps,
      vpc: vpc,
      processingQueue: coreStack.queue,
    });

    // Add dependency (optional, CDK often infers)
    computeStack.addDependency(coreStack);
    ```
    *Note: This relies on environment variables like `AWS_DEFAULT_REGION` being available in the CDK execution context (both locally if testing and in GitLab CI).* Added checks.

**Step 5: Implement Basic Tagging with Aspects**

1.  Create `lib/tagging-aspect.ts`.
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
3.  Open `bin/<your-project-name>.ts` again.
4.  **Add Code:** Import and apply the aspect at the end of the file.
    ```typescript
    // bin/<your-project-name>.ts
    // ... (previous imports and code) ...
    import { BasicTagger } from '../lib/tagging-aspect';

    // ... (app, deploymentProps, vpc, coreStack, computeStack instantiation) ...

    // Apply tags to all taggable resources
    cdk.Aspects.of(app).add(new BasicTagger('environment', 'dev'));
    cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
    // You can retrieve GitLab CI variables if available to make tags more dynamic
    // cdk.Aspects.of(app).add(new BasicTagger('gitlab-project', process.env.CI_PROJECT_PATH || 'unknown'));
    ```

**Step 6: Set up GitLab CI/CD**

1.  In the root of your project, create/edit the file named `.gitlab-ci.yml`.
2.  **Add Code:** Paste the following pipeline definition. It uses the `cdk` runner tag and leverages the pre-configured AWS credentials.

    ```yaml
    # .gitlab-ci.yml
    stages:
      - validate # Check prerequisites
      - build    # Build CDK app
      - deploy-dev # Deploy to development environment

    variables:
      NODE_VERSION: "18" # Node.js version for the build image
      # AWS_DEFAULT_REGION: "us-east-1" # Optional: Set if not configured in GitLab group/runner

    default:
      tags: [cdk] # Ensures jobs run on the correct GitLab Runner

    validate_aws_connection:
      stage: validate
      image:
        name: amazon/aws-cli:latest # Use official AWS CLI image for this check
        entrypoint: [""]
      tags: [cdk] # Ensure this also uses the tagged runner
      script:
        - echo "Verifying AWS connection using automatically provided GitLab credentials..."
        - aws sts get-caller-identity # Checks if credentials work
        - echo "AWS connection verified."
      rules: # Run on pushes to the default branch (e.g., main/master)
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    build_cdk:
      stage: build
      image: node:${NODE_VERSION} # Use Node.js image for build steps
      tags: [cdk]
      cache: # Cache node_modules for speed
        key:
          files: [package-lock.json] # Or yarn.lock
        paths: [node_modules/]
      script:
        - echo "Installing dependencies..."
        - npm ci # Clean install in CI
        - echo "Building TypeScript code..."
        - npm run build
        - echo "Synthesizing CloudFormation template..."
        - npx cdk synth --all # Use npx to run locally installed CDK
      artifacts:
        paths: [cdk.out] # Save synthesized templates
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    deploy_to_dev:
      stage: deploy-dev
      image: node:${NODE_VERSION} # Use Node.js image with CDK installed
      tags: [cdk]
      needs: [build_cdk] # Wait for build job
      dependencies: [build_cdk] # Download artifacts from build job
      script:
        # Credentials are automatically available from GitLab group config.
        # AWS_DEFAULT_REGION should also be available if set in group/runner config.
        - echo "Deploying stacks to Dev environment (Region: ${AWS_DEFAULT_REGION:-check_runner_config})..."
        # Use npx to run locally installed CDK (from node_modules)
        - npx cdk deploy --all --require-approval never --outputs-file cdk-outputs.json
      environment:
        name: dev # Define GitLab environment
      artifacts:
        paths: [cdk-outputs.json] # Save deployment outputs
      rules:
        - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

    ```

**Step 7: Deploy and Verify**

1.  **Commit and Push:**
    * **Using GitLab Web UI:** Commit the changes directly.
    * **Using VS Code:** Stage, commit, and push your changes.
        ```bash
        git add .
        # Check status if needed: git status
        git commit -m "Lab 1: Implement Core/Compute stacks and basic CI/CD"
        git push origin main # Or your default branch name (e.g., master)
        ```
2.  **Monitor Pipeline:** Go to your GitLab project's `Build -> Pipelines` section. A new pipeline should start automatically.
    * Observe the `validate_aws_connection`, `build_cdk`, and `deploy_to_dev` jobs.
    * Click into a job to see its log output. Troubleshoot any errors (check logs carefully). The `validate` job confirms your AWS connection early.
3.  **Check CloudFormation:** Once `deploy_to_dev` succeeds, go to the AWS CloudFormation console in the target region. Verify the `CoreStack` and `ComputeStack` are in `CREATE_COMPLETE` status.
4.  **Check Resources:**
    * Navigate to the S3, SQS, and EC2 consoles to see the created bucket, queue, and instance. Note the instance ID.
5.  **Test the Flow:**
    * **Manual SQS Test:** Go to the SQS Console -> Queues -> Select your queue -> Send and receive messages -> Enter `{"test": "Hello from console"}` -> Send message.
    * **Check EC2 Logs:** Go to EC2 Console -> Instances -> Select your instance -> Connect -> Choose **Session Manager** -> Connect.
    * Once connected to the instance terminal, view the log:
        ```bash
        tail -f /home/ec2-user/sqs_messages.log
        ```
    * You should see the message you sent logged within about 15-20 seconds (allowing for poll interval and wait time). Example output: `Received message ID: <some-uuid> Body: {"test": "Hello from console"}`

**Congratulations! You have completed Lab 1.** You've set up a CDK project, defined basic infrastructure, and configured an automated GitLab CI/CD pipeline that leverages pre-configured credentials to deploy your stacks. You also verified the EC2 instance can poll and receive messages from the SQS queue.