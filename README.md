# AWS CDK with TypeScript & GitLab CI/CD Workshop

Welcome to this intensive 3-day hands-on workshop focused on building a complete document processing pipeline using AWS CDK with TypeScript and GitLab CI/CD pipelines.

## Course Overview

This workshop is designed for experienced TypeScript developers already familiar with AWS, CDK, and GitLab fundamentals. Through six progressive labs, you'll build a comprehensive document processing solution while implementing infrastructure as code best practices.

## Prerequisites

- Intermediate TypeScript knowledge
- AWS account with admin access
- GitLab account with ability to create projects
- Working knowledge of AWS services (S3, SQS, DynamoDB, EC2, ECS, etc.)
- Basic understanding of CDK concepts
- Familiarity with GitLab CI/CD principles
- Laptop with:
  - Node.js v14+ installed
  - AWS CLI configured
  - Git installed
  - VS Code or preferred IDE

## Overall Project Goal

Build a document processing pipeline using AWS CDK and TypeScript. The pipeline will:
* Accept document uploads to **Amazon S3**
* Queue processing tasks using **Amazon SQS**
* Process documents leveraging **AWS AI services (Textract and Comprehend)**
* Store structured results and metadata in **Amazon DynamoDB**
* Begin with compute running on **Amazon EC2** instances and then refactor to scalable, containerized **Amazon ECS Fargate** tasks
* Deliver a **globally available static informational interface** using **Amazon CloudFront** backed by Amazon S3
* Implement the entire infrastructure deployment and updates via **GitLab CI/CD**, incorporating best practices such as **cross-account promotion** from Dev to Prod environments, **automated testing** (unit tests, snapshot tests, and compliance checks using CDK Aspects), secure **resource namespacing**, and operational **monitoring** using CloudWatch Alarms and SNS notifications

## Workshop Structure

Each lab will build incrementally on previous work, with each lab taking approximately 2-3 hours to complete.

### Day 1: Foundation & CI/CD Basics

- [Lab 1: Foundation + GitLab CI/CD Bootstrapping + VPC Import](./lab-1/README.md)
  - Setting up the CDK project structure
  - Bootstrapping AWS environments
  - Implementing GitLab CI/CD pipelines
  - Importing existing VPC resources

- [Lab 2: Cross-Account CI/CD + Resource Prefixing](./lab-2/README.md)
  - Implementing cross-account deployment patterns
  - Setting up secure resource naming conventions
  - Configuring environment-specific parameters
  - Managing deployment permissions

### Day 2: Core Pipeline Logic & Custom Resources

- [Lab 3: AI (Comprehend) + DynamoDB + Custom Resource Seeding](./lab-3/README.md)
  - Setting up DynamoDB tables for document metadata
  - Integrating AWS Comprehend for text analysis
  - Creating custom resources for initial data seeding
  - Implementing event-driven processing

- [Lab 4: Event Pipeline Complete (Textract + Real File Ingestion)](./lab-4/README.md)
  - Creating S3 buckets for document uploads
  - Configuring SQS queues for processing tasks
  - Implementing Textract integration for document processing
  - Building complete event processing flows

### Day 3: Testing, Refactoring & Exposure

- [Lab 5: Automated Tests + Infrastructure Compliance](./lab-5/README.md)
  - Writing unit tests for CDK constructs
  - Implementing snapshot testing
  - Adding CDK Aspects for compliance checks
  - Setting up test automation in CI/CD

- [Lab 6: Refactor to Fargate + Monitoring + CloudFront Static Site](./lab-6/README.md)
  - Refactoring EC2 workloads to ECS Fargate
  - Implementing CloudWatch alarms and SNS notifications
  - Creating a static website with CloudFront distribution
  - Finalizing the end-to-end solution

## Workshop Materials

Each lab contains:
- README with step-by-step instructions
- Code samples to copy/paste
- Architectural diagrams
- Exercise solutions
- Implementation tips and best practices

## Getting Help

If you encounter issues during the workshop:
- Check the [Troubleshooting Guide](./resources/troubleshooting.md)
- Refer to [Common Errors & Solutions](./resources/common-errors.md)
- Ask questions through GitLab issues

## Additional Resources

- [AWS CDK TypeScript Reference](https://docs.aws.amazon.com/cdk/api/latest/typescript/api/index.html)
- [GitLab CI/CD Documentation](https://docs.gitlab.com/ee/ci/)
- [Workshop Code Repository](https://gitlab.com/your-workshop-repo)
- [Cheat Sheets](./resources/cheatsheets/README.md)

---

© 2025 CredoSec