---
layout: default
title: Lab 6a Cheatsheet
parent: Cheatsheets
grand_parent: Resources
nav_order: 6
---

# Lab 6a Troubleshooting Tips (Fargate Refactor)

This covers common issues encountered when containerizing the application and refactoring the Compute Stack to use ECS Fargate.

## 1. Docker Build Issues (Local)

* **Problem:** `docker build` fails with `401 Unauthorized` or `failed to authorize` when trying to pull the base image (e.g., `node:18-alpine`).
    * **Diagnosis:** Docker client needs authentication with Docker Hub, possibly due to rate limits.
    * **Solution:** Run `docker login` in your terminal and provide your Docker Hub credentials (create a free account if needed). Retry the build.

* **Problem:** `docker build` fails during a `COPY --from=builder ...` step with errors like `"/package.json": not found` or `"/#": not found`.
    * **Diagnosis:** Issues with the order of operations (`COPY`, `RUN`) in the `Dockerfile`'s builder stage, or Docker layer caching problems. The required file (`package.json` in this case) isn't found in the builder stage context when the final stage tries to copy it.
    * **Solution:**
        1.  Ensure your `Dockerfile` uses a standard multi-stage pattern (in builder: `COPY package*.json -> RUN npm ci -> COPY source_code`).
        2.  Ensure the final stage explicitly copies required artifacts (`package.json`, `node_modules`, `index.js`) from the builder stage using correct paths (`COPY --from=builder /usr/src/app/FILE ./`).
        3.  If the error persists, try building without cache: `docker build --no-cache -t processing-app ./processor-app`.

## 2. Container Runtime Errors (CloudWatch Logs)

* **Problem:** Fargate task starts but quickly stops. CloudWatch Logs show `SyntaxError: Cannot use import statement outside a module`.
    * **Diagnosis:** Node.js inside the container is running `index.js` as CommonJS, but the code uses ES Module `import` syntax.
    * **Solution:**
        1.  Verify `processor-app/package.json` contains `"type": "module",`.
        2.  Verify the `Dockerfile` **copies `package.json` into the final stage** (`COPY --from=builder /usr/src/app/package.json ./package.json`).
        3.  **Crucially:** After fixing files, **rebuild** (`docker build`), **re-push** (`docker push`) the image to ECR, and **force a new deployment** of the Fargate service (via ECS Console or AWS CLI `--force-new-deployment`) to ensure the running task uses the updated image.
        4.  Use the debug `CMD` in the Dockerfile (`CMD ["sh", "-c", "ls -la && cat package.json && node index.js"]`) to confirm in CloudWatch Logs that `package.json` with `"type": "module"` is present in `/usr/src/app` when the container starts.

* **Problem:** Other Node.js errors in CloudWatch Logs (e.g., cannot find module, environment variable undefined, SDK errors).
    * **Diagnosis:** Missing dependencies, incorrect environment variables passed from CDK, or bugs in the `processor-app/index.js` logic.
    * **Solution:** Check `Dockerfile` ensures `node_modules` are copied correctly. Verify the `environment: { ... }` block in the `QueueProcessingFargateService` definition (`lib/compute-stack.ts`) passes all required variables (`TABLE_NAME`, `AWS_REGION`, `QUEUE_URL`). Debug the Node.js code (`processor-app/index.js`) for logic errors or incorrect SDK usage.

## 3. Fargate Task Not Starting / Scaling Issues

* **Problem:** SQS queue has messages, but no Fargate tasks are launched, or tasks fail to reach RUNNING state. No new CloudWatch log streams appear, or they show errors very early.
    * **Diagnosis:** This often points to issues preventing ECS from placing or starting the task container. Common causes include:
        * **ECS Service Events:** Check the Service's "Events" tab in the ECS console for specific errors (e.g., "unable to place tasks due to...").
        * **Task Definition:** Incorrect ECR Image URI or tag (`:latest` points to a non-existent/pushed image?). Insufficient CPU/Memory allocation.
        * **Task Execution Role Permissions:** The role ECS uses to start the task lacks permissions for ECR (`ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`) or CloudWatch Logs (`logs:CreateLogStream`, `logs:PutLogEvents`). (The CDK pattern usually sets these, but verify).
        * **Networking:** Tasks in private subnets cannot reach required AWS services (ECR, CloudWatch Logs, SQS, etc.). Verify VPC has **NAT Gateway** for private subnets OR **VPC Endpoints** for *all* required services (ECR API/DKR, S3 Gateway, Logs, SQS, Textract, Comprehend, DDB, STS). Check the Fargate service's **Security Group** allows necessary outbound HTTPS traffic. Check if private subnets have run out of available IP addresses.
        * **Auto Scaling Configuration:** Check the ECS Service -> Auto Scaling tab and Application Auto Scaling console. Verify the Scalable Target has Min=0, Max>0. Verify scaling policies target the correct SQS metric ARN. Check associated CloudWatch Alarms state. (Less likely to prevent the *first* task from launching if messages > 0).
    * **Solution:** Address the specific issue identified in Events, Task Definition, IAM Roles, or Networking. Force a new deployment after fixing configuration issues. Use `aws ecs run-task --task-definition ... --cluster ... --network-configuration ...` manually for more direct diagnostic feedback.

## 4. CDK Synthesis Errors (`cdk synth`/`deploy`)

* **Problem:** `Error: You can only specify either vpc or cluster...`
    * **Diagnosis:** Passed both `vpc` and `cluster` props to `QueueProcessingFargateService` in `lib/compute-stack.ts`.
    * **Solution:** Remove the `vpc` prop when `cluster` is provided.

* **Problem:** `Error: visibilityTimeout can be set only when queue is not set...`
    * **Diagnosis:** Passed both `queue` and `visibilityTimeout` props to `QueueProcessingFargateService` in `lib/compute-stack.ts`.
    * **Solution:** Remove `visibilityTimeout` prop from the service; set it on the `sqs.Queue` definition in `lib/core-stack.ts` if a non-default value is needed.