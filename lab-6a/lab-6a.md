---
layout: default
title: Lab 6a Hands-on Instructions
nav_order: 61
has_children: true
---

# Lab 6a: Refactor Compute to ECS Fargate

## Goal

Replace the EC2-based SQS message processor with a scalable, containerized solution using Amazon ECS with AWS Fargate.

## Prerequisites

* Completion of Lab 5. Your project deploys successfully to Dev with prefixing, tests, monitoring, and aspects. Code should match final state from Lab 5.
* **Docker:** Docker installed and running on your local machine. *(See Step 0)*.
* **AWS Credentials:** Local AWS credentials configured for the Dev environment with permissions to interact with ECR (push images) and deploy CDK stacks.
* **Processor App Code:** You will need the Node.js application code for the SQS message processor (`index.js`). This should be provided by your instructor or in accompanying lab materials. *(Ensure you have the version using SDK v3 imports and correct try/catch logic)*.

---

## Step 0: Install Docker (If Needed)

This lab requires building a Docker image locally. If you do not already have Docker installed on your local machine, please install it now.

1.  **Download Docker:** Go to the official Docker website: [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2.  **Follow Installation Instructions:** Choose the appropriate version for your operating system (Mac, Windows, or Linux) and follow the installation guide.
3.  **Note on Docker Desktop:** Check Docker's licensing terms for your use case.
4.  **Verify Installation:** Open your terminal and run `docker --version`. Ensure the Docker Desktop application or daemon is running.

---

## Step 1: Containerize the Processing Logic

Create the Node.js application structure, code, and the Dockerfile.

1.  **Create App Directory:** In your CDK project root:
    ```bash
    mkdir processor-app
    ```
2.  **Initialize Node.js Project & Configure Module Type:**
    ```bash
    cd processor-app
    npm init -y
    # Edit processor-app/package.json and ADD the line: "type": "module",
    # Example:
    # {
    #   "name": "processor-app", ...
    #   "main": "index.js",
    #   "type": "module", // <<< ADD THIS
    #   "scripts": { ... }, ...
    # }
    npm install @aws-sdk/client-sqs @aws-sdk/client-s3 @aws-sdk/client-textract @aws-sdk/client-comprehend @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
    cd ..
    ```
3.  **Create Handler File (`index.js`):** Create the file `processor-app/index.js` and paste the provided Node.js application code into it. This code contains the logic to poll SQS, call Textract/Comprehend, write to DynamoDB, and delete messages using AWS SDK v3. *(Instructor: Ensure students have access to the correct index.js content with necessary try/catch blocks)*.
4.  **Create `Dockerfile`:** Create the file `processor-app/Dockerfile` and paste the following content:
    ```dockerfile
    # Dockerfile for processor-app (Revised Build Order v3 & Debug CMD)
    FROM node:18-alpine AS builder

    WORKDIR /usr/src/app

    # Copy package files FIRST
    COPY package*.json ./
    # Install production dependencies based on lock file
    RUN npm ci --only=production

    # Copy application code AFTER installing dependencies
    COPY index.js ./
    # If you had other source files (e.g., in a 'src/' dir), copy them too:
    # COPY src ./src

    # Final stage
    FROM node:18-alpine

    WORKDIR /usr/src/app

    # Copy necessary artifacts from builder stage
    COPY --from=builder /usr/src/app/package.json ./
    COPY --from=builder /usr/src/app/node_modules ./node_modules
    COPY --from=builder /usr/src/app/index.js ./

    ENV NODE_PATH=/usr/src/app/node_modules

    # Debug CMD: List files, print package.json, then run app
    CMD ["sh", "-c", "echo '--- Listing /usr/src/app ---' && ls -la && echo '--- package.json content ---' && cat package.json && echo '--- Running index.js ---' && node index.js"]
    ```

---

## Step 2: Create ECR Repository in CDK

Modify `lib/core-stack.ts` to define the ECR repository.

1.  **Open `lib/core-stack.ts`**.
2.  **Add Import:** `import * as ecr from 'aws-cdk-lib/aws-ecr';`
3.  **Define Repository Property:** Add `public readonly ecrRepo: ecr.Repository;` to the `CoreStack` class.
4.  **Create Repository:** Add the following code inside the `constructor`. Remember to replace `stuXX` with your unique identifier logic consistent with previous labs.
    ```typescript
      // Inside CoreStack constructor
      const prefix = this.node.tryGetContext('prefix') || `stuXX-${this.node.tryGetContext('environment') || 'dev'}`;

      // --- ECR Repository ---
      this.ecrRepo = new ecr.Repository(this, 'ProcessingAppRepo', {
        repositoryName: `${prefix}-processor-repo`.toLowerCase(),
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteImages: true,
        imageScanOnPush: true,
      });

      // Output Repository URI
      new cdk.CfnOutput(this, 'EcrRepoUri', { value: this.ecrRepo.repositoryUri });
    ```

---

## Step 3: Deploy CoreStack & Get ECR URI

Deploy the `CoreStack` changes to create the ECR repository in AWS.

1.  **Commit `CoreStack` Changes:** Save, commit, and push changes to `lib/core-stack.ts`.
    ```bash
    git add lib/core-stack.ts
    git commit -m "Lab 6a: Add ECR repository to CoreStack"
    git push origin main
    ```
2.  **Monitor Pipeline:** Ensure the `deploy_dev` job completes successfully in GitLab.
3.  **Get ECR Repo URI:** Go to the AWS CloudFormation console, select the `${prefix}-CoreStack` stack, go to Outputs, and copy the `EcrRepoUri` value.

---

## Step 4: Build and Push Docker Image (Manual Step)

Build the container image locally and push it to the ECR repository you just created.

1.  **Authenticate Docker to ECR:** Run in your local terminal (replace placeholders):
    ```bash
    aws ecr get-login-password --region <YOUR_DEV_REGION> | docker login --username AWS --password-stdin <YOUR_DEV_ACCOUNT_ID>.dkr.ecr.<YOUR_DEV_REGION>.amazonaws.com
    ```
2.  **Build Docker Image:** Run from your project root directory:
    ```bash
    docker build -t processing-app ./processor-app
    ```
    > **Troubleshooting Note:** If build fails with `401 Unauthorized`, run `docker login` first. If it fails with file errors, try `docker build --no-cache ...`.
3.  **Tag Docker Image:** Use the ECR URI copied in the previous step:
    ```bash
    docker tag processing-app:latest <YOUR_ECR_REPO_URI>:latest
    ```
4.  **Push Docker Image:**
    ```bash
    docker push <YOUR_ECR_REPO_URI>:latest
    ```
    Verify the push completes successfully.

---

## Step 5: Refactor `ComputeStack` to use Fargate

Modify `lib/compute-stack.ts` to remove the EC2 instance and replace it with the `QueueProcessingFargateService`. Also update `bin/app.ts` to pass the necessary ECR repo name.

1.  **Open `lib/compute-stack.ts`**.
2.  **Add/Update Imports:** Add `ecs`, `ecr`, `ecs_patterns`, `logs`. Keep `ec2`. Remove `fs`, `path`.
    ```typescript
    import * as ecs from 'aws-cdk-lib/aws-ecs';
    import * as ecr from 'aws-cdk-lib/aws-ecr';
    import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
    import * as logs from 'aws-cdk-lib/aws-logs';
    import * as ec2 from 'aws-cdk-lib/aws-ec2'; // Keep for Vpc.fromLookup
    // Keep: cdk, Construct, iam, sqs, dynamodb, s3
    // Remove: fs, path
    ```
3.  **Update Props Interface:** Ensure `inputBucket`, `processingQueue`, `table` are present. Add `ecrRepoName`.
    ```typescript
     export interface ComputeStackProps extends cdk.StackProps {
       processingQueue: sqs.Queue;
       table: dynamodb.ITable;
       inputBucket: s3.IBucket;
       ecrRepoName: string; // Pass ECR repo name
     }
    ```
4.  **Replace Constructor Content:** Replace the *entire content* inside the `constructor` (after `super(scope, id, props);`) with the following ECS/Fargate logic:
    ```typescript
      // Inside ComputeStack constructor - REPLACING EC2 logic

      // --- Look up VPC ---
      const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { tags: { Name: 'WorkshopVPC' } });

      // --- ECS Cluster ---
      const cluster = new ecs.Cluster(this, 'ProcessingCluster', { vpc: vpc, clusterName: `${id}-Cluster` });

      // --- Reference ECR Repo ---
      const ecrRepo = ecr.Repository.fromRepositoryName(this, 'EcrRepo', props.ecrRepoName);

      // --- Define Log Group for Fargate Task ---
      const logGroup = new logs.LogGroup(this, 'FargateLogGroup', {
          logGroupName: `/ecs/${id}-FargateService`,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      // --- Queue Processing Fargate Service ---
      const fargateService = new ecs_patterns.QueueProcessingFargateService(this, 'QueueProcessingService', {
        cluster: cluster,
        memoryLimitMiB: 1024, // Increased
        cpu: 512, // Increased
        image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
        queue: props.processingQueue,
        environment: {
          TABLE_NAME: props.table.tableName,
          AWS_REGION: this.region,
          QUEUE_URL: props.processingQueue.queueUrl
        },
        maxScalingCapacity: 2,
        minScalingCapacity: 0,
        visibilityTimeout: cdk.Duration.minutes(5), // Adjust if needed
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'doc-processor', logGroup: logGroup }),
      });

      // --- Grant Additional Permissions to Fargate Task Role ---
      props.table.grantWriteData(fargateService.taskDefinition.taskRole);
      props.inputBucket.grantRead(fargateService.taskDefinition.taskRole);
      fargateService.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['comprehend:DetectSentiment', 'textract:DetectDocumentText'],
        resources: ['*'],
      }));

      // --- Stack Outputs ---
      new cdk.CfnOutput(this, 'EcsClusterName', { value: cluster.clusterName });
      new cdk.CfnOutput(this, 'FargateServiceName', { value: fargateService.service.serviceName });
      new cdk.CfnOutput(this, 'FargateLogGroupName', { value: logGroup.logGroupName });
      new cdk.CfnOutput(this, 'LookedUpVpcId', { value: vpc.vpcId });
    ```
5.  **Update `bin/app.ts`:** Modify the `ComputeStack` instantiation to pass the `ecrRepoName`.
    ```typescript
      // Inside bin/app.ts
      const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
        // ... other props ...
        ecrRepoName: coreStack.ecrRepo.repositoryName // Pass repo name
      });
    ```

---

## Step 6: Deploy and Verify

Deploy the Fargate compute stack and test the full flow.

1.  **Deploy `ComputeStack`:** Commit and push changes to `lib/compute-stack.ts` and `bin/app.ts` (and `processor-app/Dockerfile`, `processor-app/package.json` if they changed). Run the pipeline again.
    ```bash
    git add lib/compute-stack.ts bin/app.ts processor-app/Dockerfile processor-app/package.json # Add all changed files
    git commit -m "Lab 6a: Refactor ComputeStack to Fargate"
    git push origin main
    ```
    Monitor the `deploy_dev` job in the pipeline.
    > **IMPORTANT - Force New Deployment:** After `deploy_dev` succeeds, **force a new deployment** of the Fargate service (ECS Console -> Cluster -> Service -> Update -> check 'Force new deployment' -> Update) to ensure it pulls the image you pushed in Step 4.
2.  **Check CloudWatch Logs for Debug Output:**
    * Go to CloudWatch -> Log groups -> Find `/ecs/${prefix}-ComputeStack-FargateService`.
    * Look at the latest log stream(s).
    * Verify the `ls -la` and `cat package.json` output (from the debug `CMD`) look correct, and that the `SyntaxError` is gone. You should see the "Running index.js..." message followed by your application logs (like "Polling SQS Queue...").
3.  **Verify ECS Resources / Test End-to-End (If logs look correct):**
    * Upload a sample **PDF file** to the S3 input bucket.
    * **Monitor ECS Service:** Watch the "Running tasks" count increase.
    * **Check CloudWatch Logs:** Check the log stream again for processing messages related to your file.
    * **Verify DynamoDB:** Check your DynamoDB table for the new item with processed results.
    * **Verify SQS:** Check the SQS queue - message should be processed and deleted.

---

## Step 7: Clean Up Resources

* Run `cdk destroy` for the Dev environment. Remember ECR repo might need manual deletion if images remain.

---

## Congratulations!

You have successfully refactored your compute layer to ECS Fargate!