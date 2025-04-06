---
layout: default
title: Lab 2 Cheatsheet
parent: Cheatsheets
grand_parent: Resources
nav_order: 2
---

# Lab 2 Troubleshooting Tips (CI/CD & Cross-Account)

This covers common issues when setting up the cross-account deployment pipeline in Lab 2.

## 1. Prod jobs (`bootstrap_prod`, `deploy_to_prod`) fail with `aws: command not found`.
    * **Diagnosis:** The job is likely running using a Docker image (e.g., `node:XX`) that does not contain the AWS CLI v2 executable, which is required for the `aws sts assume-role` command. Check the job log to confirm which image was actually used.
    * **Solution:** Ensure the `image:` specified for the `bootstrap_prod` and `deploy_to_prod` jobs in `.gitlab-ci.yml` points to an image containing both Node.js/npm AND AWS CLI v2 (e.g., `public.ecr.aws/sam/build-nodejs18.x:latest`).

## 2.  Prod jobs fail with `Failed to assume role!` or similar permission errors during the `aws sts assume-role` command.
    * **Diagnosis:** Several possible causes: Incorrect `ROLE_ARN` placeholder value used; incorrect `PROD_ACCOUNT_ID` or `PROD_REGION` GitLab CI/CD variables set; Trust Policy on the `CDKDeployRole` in Prod doesn't allow assumption from the Dev/CI role/user; Dev/CI role/user lacks `sts:AssumeRole` permission.
    * **Solution:** Verify the `ROLE_ARN` in the script. Verify the `PROD_ACCOUNT_ID`, `PROD_REGION` variables in GitLab CI/CD settings. Check the Trust Policy on the `CDKDeployRole` in the Prod AWS account. Check IAM permissions for the GitLab runner's role/user in the Dev/CI account.

## 3.  Prod jobs fail with `Failed to parse credentials!` or errors related to `jq: command not found`.
    * **Diagnosis:** The `jq` command-line JSON processor, used to extract temporary credentials from the `assume-role` output, is not available in the Docker image being used, OR the `assume-role` command failed before `jq` ran.
    * **Solution:** If `jq` is missing, add an install command (e.g., `# apt-get update && apt-get install -y jq || apk add --no-cache jq`) to the job's `script:`. If assume-role failed, fix that first. (Note: The recommended `sam/build-nodejs` image includes `jq`).

## 4.  `cdk bootstrap` or `cdk deploy` fails in Prod jobs *after* successfully assuming the role.
    * **Diagnosis 1:** The assumed `CDKDeployRole` in the Prod account lacks sufficient IAM permissions (CloudFormation, S3, IAM, SQS, EC2, etc.).
    * **Solution 1:** Review and update the permissions policy attached to the `CDKDeployRole` in the Prod AWS account's IAM console.
    * **Diagnosis 2:** The CDK code fails during synthesis or deployment, potentially during `Vpc.fromLookup` (e.g., error "Could not find VPC...", "Context provider failed...").
    * **Solution 2:** Ensure the prerequisite VPC (tagged `Name=WorkshopVPC`) **exists in the target Prod account/region** *before* running the Prod deployment jobs. Verify the VPC was created correctly (e.g., using the provided CloudFormation template) and that it has the exact tags used in the CDK code's `Vpc.fromLookup` call (`Name=WorkshopVPC`).

## 5.  Resources deployed to Dev or Prod do not have the correct stack name prefixes (e.g., `stuXX-dev-CoreStack`) or tags (`environment: dev`).
    * **Diagnosis:** Context flags (`-c prefix=...`, `-c environment=...`) might be missing or incorrect in `.gitlab-ci.yml` deploy commands, OR `bin/app.ts` code not reading/using context correctly, OR prefix definition logic (`STUDENT_PREFIX`) in CI script is faulty.
    * **Solution:** Verify `-c` flags in CI jobs. Verify `tryGetContext` calls and usage in `bin/app.ts`. Verify prefix variable logic in CI script. Check default values in `bin/app.ts` for local execution.