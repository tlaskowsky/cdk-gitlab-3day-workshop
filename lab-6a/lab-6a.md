---
layout: default
title: Lab 6a Hands-on Instructions
nav_order: 61
has_children: true
sitemap: false
published: false
nav_exclude: true  # Many Jekyll themes use this
---

# Lab 6a: Refactor Compute to ECS Fargate

## Goal

Replace the EC2-based SQS message processor with a scalable, containerized solution using Amazon ECS with AWS Fargate.

## Prerequisites

* Completion of Lab 5. Your project deploys successfully to Dev with prefixing, tests, monitoring, and aspects. Code should match final state from Lab 5.
* **Docker:** Docker installed and running on your local machine. *(See Step 0)*.
* **AWS Credentials:** Local AWS credentials configured for the Dev environment with permissions to interact with ECR (push images) and deploy CDK stacks.

---

## Step 0: Install Docker (If Needed)

This lab requires building a Docker image locally. If you don't have Docker installed, follow the instructions at [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/) for your OS. Verify with `docker --version`. Ensure Docker Desktop/daemon is running.

---

## Step 1: Containerize the Processing Logic

Create the Node.js application and Dockerfile.

1.  **Create App Directory:** In project root: `mkdir processor-app`
2.  **Initialize Node.js Project & Configure Module Type:**
    ```bash
    cd processor-app
    npm init -y
    # Edit processor-app/package.json, ADD "type": "module",
    npm install @aws-sdk/client-sqs @aws-sdk/client-s3 @aws-sdk/client-textract @aws-sdk/client-comprehend @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
    cd ..
    ```
    *Ensure `processor-app/package.json` contains `"type": "module",`.*
3.  **Create Handler File (`index.js`):** Create `processor-app/index.js` and paste the Node.js/SDKv3 code (as provided and corrected in Turn #229).
4.  **Create `Dockerfile`:** Create `processor-app/Dockerfile` and paste the following **corrected** content with the refined build order and debug CMD:
    ```dockerfile
    # Dockerfile for processor-app (Revised Build Order v3 & Debug CMD)
    FROM node:18-alpine AS builder

    WORKDIR /usr/src/app

    # Copy package files FIRST
    COPY package*.json ./
    # Install production dependencies based on lock file
    RUN npm ci --only=production

    # Copy application code AFTER installing dependencies
    # This helps Docker layer caching if only code changes
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
3.  **Define Repository Property:** Add `public readonly ecrRepo: ecr.Repository;` to the class.
4.  **Create Repository:** Add this inside the constructor. Use the `prefix` context variable.
    ```typescript
      // Inside CoreStack constructor
      const prefix = this.node.tryGetContext('prefix') || `stuXX-${this.node.tryGetContext('environment') || 'dev'}`; // Get prefix

      // --- ECR Repository ---
      this.ecrRepo = new ecr.Repository(this, 'ProcessingAppRepo', {
        repositoryName: `${prefix}-processor-repo`.toLowerCase(), // ECR names must be lowercase
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteImages: true, // Automatically delete images on destroy
        imageScanOnPush: true,
      });

      // Output Repository URI
      new cdk.CfnOutput(this, 'EcrRepoUri', { value: this.ecrRepo.repositoryUri });
    ```
    > **Action:** Replace `stuXX` if needed.

---

## Step 3: Deploy CoreStack & Get ECR URI

Deploy `CoreStack` to create the ECR repository.

1.  **Commit `CoreStack` Changes:** Save the changes to `lib/core-stack.ts`. Commit *only* this file (and potentially `package.json`/`lock` if dependencies changed).
    ```bash
    git add lib/core-stack.ts # Add package*.json if needed
    git commit -m "Lab 6a: Add ECR repository to CoreStack"
    git push origin main
    ```
2.  **Monitor Pipeline:** Go to GitLab (`Build -> Pipelines`) and monitor the pipeline triggered by the push. Ensure the `deploy_dev` job completes successfully.
3.  **Get ECR Repo URI:**
    * Go to the **AWS CloudFormation console** in your Dev region.
    * Select the `${prefix}-CoreStack` stack (e.g., `stu20-dev-CoreStack`).
    * Go to the **Outputs** tab.
    * Find the output key `EcrRepoUri` and **copy its Value**. This is `<YOUR_ECR_REPO_URI>`. You will need it in the next step.

---

## Step 4: Build and Push Docker Image (Manual Step)

Perform these steps locally using the ECR URI obtained above. **Ensure you run this *after* updating the `Dockerfile` and `package.json`.**

1.  **Authenticate Docker to ECR:**
    ```bash
    aws ecr get-login-password --region <YOUR_DEV_REGION> | docker login --username AWS --password-stdin <YOUR_DEV_ACCOUNT_ID>.dkr.ecr.<YOUR_DEV_REGION>.amazonaws.com
    ```
    (Replace placeholders with your Dev account/region values).
2.  **Build Docker Image:** (From project root)
    ```bash
    docker build -t processing-app ./processor-app
    ```
    > **Troubleshooting Note:** If the build fails, try building without the cache: `docker build --no-cache -t processing-app ./processor-app`. If you get `401 Unauthorized`, run `docker login` to Docker Hub first.
3.  **Tag Docker Image:**
    ```bash
    docker tag processing-app:latest <YOUR_ECR_REPO_URI>:latest
    ```
    (Replace `<YOUR_ECR_REPO_URI>` with the actual value).
4.  **Push Docker Image:**
    ```bash
    docker push <YOUR_ECR_REPO_URI>:latest
    ```
    (Verify this completes successfully).

---

## Step 5: Refactor `ComputeStack` to use Fargate

Modify `lib/compute-stack.ts` and `bin/app.ts`.

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
4.  **Replace Constructor Content:** Replace the *entire content* inside the `constructor` (after `super(scope, id, props);`) with the ECS/Fargate logic (using `ecs_patterns.QueueProcessingFargateService`, removing `vpc` prop from it, granting permissions to `fargateService.taskDefinition.taskRole`).
    ```typescript
      // Inside ComputeStack constructor - REPLACING EC2 logic

      // --- Look up VPC --- (Keep this)
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
        cluster: cluster, // Provide the cluster
        // vpc: vpc,      // REMOVED - Do NOT provide VPC when cluster is provided
        memoryLimitMiB: 1024,
        cpu: 512,
        image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
        queue: props.processingQueue, // Provide existing queue
        environment: {
          TABLE_NAME: props.table.tableName,
          AWS_REGION: this.region,
          QUEUE_URL: props.processingQueue.queueUrl
        },
        maxScalingCapacity: 2,
        minScalingCapacity: 0,
        // Note: Configure visibilityTimeout on the sqs.Queue construct in CoreStack if needed (default is 30s)
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'doc-processor', logGroup: logGroup }),
      });

      // --- Grant Additional Permissions to Fargate Task Role ---
      // The pattern creates fargateService.taskDefinition.taskRole
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
      // ... (CoreStack instantiation) ...
      const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);

      // ...
      const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
        ...deploymentProps,
        processingQueue: coreStack.queue,
        table: coreStack.table,
        inputBucket: coreStack.bucket,
        ecrRepoName: coreStack.ecrRepo.repositoryName // Pass repo name
      });
      // ... (Aspects) ...
    ```

---

## Step 6: Deploy and Verify

Deploy the Fargate compute stack and test.

1.  **Deploy `ComputeStack`:** Commit and push changes to `lib/compute-stack.ts` and `bin/app.ts` (and `processor-app/Dockerfile` if changed earlier). Run the pipeline again.
    ```bash
    git add lib/compute-stack.ts bin/app.ts processor-app/Dockerfile # Add other changed files if any
    git commit -m "Lab 6a: Refactor ComputeStack to Fargate"
    git push origin main
    # Monitor pipeline...
    ```
    > **IMPORTANT - Force New Deployment:** After the `deploy_dev` job finishes successfully in the pipeline, **force a new deployment** of the Fargate service (ECS Console -> Cluster -> Service -> Update -> check 'Force new deployment' -> Update) to ensure it pulls the image you pushed in Step 4.

2.  **Check CloudWatch Logs for Debug Output:**
    * Go to CloudWatch -> Log groups -> Find `/ecs/${prefix}-ComputeStack-FargateService`.
    * Look at the latest log stream(s).
    * Verify the `ls -la` and `cat package.json` output (from the debug `CMD`) look correct, and that the `SyntaxError: Cannot use import statement outside a module` error is **gone**. You should see the "Running index.js..." message followed by your application logs (like "Polling SQS Queue...").
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

```