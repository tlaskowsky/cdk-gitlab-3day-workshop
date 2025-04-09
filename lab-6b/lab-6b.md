---
layout: default
title: Lab 6b Hands-on Instructions
nav_order: 62
has_children: true
---


# Lab 6b: CloudFront Static Site

## Goal  
Deploy a simple static web interface hosted on S3 and served securely and efficiently via an Amazon CloudFront distribution.

---

## Prerequisites

- Completion of **Lab 6a**. Your project deploys successfully to Dev with the ECS Fargate service running. Code should match the final state from Lab 6a.
- Local environment configured.

---

## Step 1: Create Frontend Assets

Create some basic files for our static website.

### Create Directory

In the root of your CDK project:

```bash
mkdir frontend
```

### Create `index.html`

Inside the `frontend` directory, create a file named `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document Processing Status</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <h1>Document Processing Pipeline</h1>
    <p>Status: Active and Processing</p>
    <p id="info">Serving static content via S3 and CloudFront.</p>
</body>
</html>
```

### Create `style.css` (Optional)

Inside the same `frontend` directory:

```css
body {
    font-family: sans-serif;
    padding: 2em;
    background-color: #f4f4f4;
    color: #333;
}
h1 {
    color: #007bff;
}
p#info {
    font-style: italic;
    font-size: 0.9em;
    color: #555;
}
```

---

## Step 2: Define Frontend Stack (`lib/frontend-stack.ts`)

Create a new CDK stack to define the S3 bucket and CloudFront distribution.

### Create File

Create `lib/frontend-stack.ts`.

### Add Imports

```ts
// lib/frontend-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
```

### Define Stack

```ts
export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket (NOT configured as website)
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      // No websiteIndexDocument property
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront Distribution with OAC
    const distribution = new cloudfront.Distribution(this, 'WebsiteDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        compress: true,
      },
      defaultRootObject: 'index.html', // This handles serving index.html at the root
    });

    // Create OAC
    const oac = new cloudfront.CfnOriginAccessControl(this, 'OAC', {
      originAccessControlConfig: {
        name: `${id}-OAC`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4'
      }
    });

    // Apply OAC to the distribution
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', '');
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.getAtt('Id'));

    // Grant CloudFront access to the S3 bucket
    websiteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [websiteBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`
        }
      }
    }));


    // Stack Outputs
    new cdk.CfnOutput(this, 'WebsiteBucketName', { value: websiteBucket.bucketName });
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'The URL for the CloudFront distribution',
    });
  }
}
```

---

## Step 3: Deploy Frontend Assets

Use the `BucketDeployment` construct to upload the frontend assets.

### Add Import

At the top of `lib/frontend-stack.ts`:

```ts
import * as s3_deployment from 'aws-cdk-lib/aws-s3-deployment';
```

### Add `BucketDeployment` inside the constructor

```ts
// Deploy Website Content
new s3_deployment.BucketDeployment(this, 'DeployWebsite', {
    sources: [s3_deployment.Source.asset('./frontend')],
    destinationBucket: websiteBucket,
    distribution: distribution,
    distributionPaths: ['/*'],
});
```

---

## Step 4: Instantiate Frontend Stack (`bin/app.ts`)

### Import FrontendStack

```ts
import { FrontendStack } from '../lib/frontend-stack';
```

### Add to App Instantiation

Inside `bin/<your-project-name>.ts`, after other stack instantiations:

```ts
console.log('Instantiating FrontendStack...');
const frontendStack = new FrontendStack(app, `${prefix}-FrontendStack`, deploymentProps);
```

> Aspects should apply to this stack too if applied at the app level.

---

## Step 5: Deploy and Verify

### Commit and Push

```bash
git add .
git commit -m "Lab 6b: Add FrontendStack with S3 and CloudFront"
git push origin main
```

> Be sure to `git add` the `frontend/` directory too.

### Monitor Pipeline

Watch the `deploy_dev` job in GitLab. It will deploy/update:
- `CoreStack`
- `ComputeStack`
- `FrontendStack`

### Verify CloudFormation

Go to the CloudFormation console and confirm `${prefix}-FrontendStack` is created.  
Note the **CloudFrontURL** output.

### Access Website

Open a browser and visit:

```text
https://<distributionDomainName>
```

You should see your **"Document Processing Pipeline"** HTML page.

> Note: CloudFront distributions can take **5–15 minutes** to fully deploy globally. If you see an error initially, wait and refresh.

### Check OAC in effect

Go to the S3 console and confirm `${prefix}-FrontendStack-websitebucket` is created.  Note the **Object URL**

### Access Website

Open a browser and visit:

```text
https://<ObjectURLe>
```

You should see your **"<Code>AccessDenied</Code>"** HTML page.

---

## Step 6: Clean Up Resources

Run the following to destroy the Dev environment, including the S3 bucket and CloudFront distribution:

```bash
cdk destroy
```

---

## Congratulations!

You have successfully deployed a static website using **S3** and **CloudFront**, protected by **OAC** protection, managed entirely through **AWS CDK**!  