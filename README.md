---
layout: default
title: AWS CDK with TypeScript & GitLab CI/CD Workshop
nav_order: 1
has_children: true
---

# AWS CDK with TypeScript & GitLab CI/CD Workshop

Welcome to this intensive 3-day hands-on workshop focused on building a document processing pipeline using AWS CDK with TypeScript and GitLab CI/CD pipelines.

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
  - CDK Fundamentals: App, Stacks, Constructs (L1/L2/L3)
  - TypeScript in CDK: Props Interfaces for Type Safety
  - AWS Core Services: S3, SQS, EC2, VPC
  - Importing Existing AWS Infrastructure: Vpc.fromLookup()
  - Basic CI/CD: GitLab CI/CD Basics (.gitlab-ci.yml, Stages, Jobs, Runners)
  - Simple Automation: Intro to CDK Aspects for Tagging

- [Lab 2: Cross-Account CI/CD + Resource Prefixing](./lab-2/README.md)
  - GitLab CI/CD Pipelines: Cross-Account Deployment Strategy
  - GitLab CI/CD Features: Manual Approvals/Gates, Environments
  - IAM for Cross-Account Access (CDKDeployRole concept)
  - CDK Context for passing configuration/parameters
  - Resource Naming Strategies & Importance

### Day 2: Core Pipeline Logic & Custom Resources

- [Lab 3: AI (Comprehend) + DynamoDB + Custom Resource Seeding](./lab-3/README.md)
  - Amazon DynamoDB: Core Concepts (Tables, Items, Keys - PK/SK, Capacity Modes)
  - IAM Permissions: Granting EC2 access to DynamoDB
  - Amazon Comprehend: Basic NLP Capabilities (Sentiment, Key Phrases)
  - CDK Custom Resources: Lambda-backed Custom Resources, Provider Framework

- [Lab 4: Event Pipeline Complete (Textract + Real File Ingestion)](./lab-4/README.md)
  - Amazon Textract: Capabilities (Sync/Async OCR, Forms, Tables)
  - Integrating Multiple AI Service Results
  - CloudWatch Logs: Basic logging from EC2
  - IAM Permissions: Granting EC2 access to Textract
  - End-to-End Event Processing: S3 → SQS → EC2 → DynamoDB pipeline

### Day 3: Testing, Refactoring & Exposure

- [Lab 5: Automated Tests + Monitoring + Infrastructure Compliance](./lab-5/README.md)
  - Testing IaC: Unit Testing, Snapshot Testing, Integration Testing concepts
  - CDK assertions Module: Template.fromStack(), hasResourceProperties()
  - Snapshot Testing with Jest (toMatchSnapshot())
  - CI/CD Test Stages: Integrating tests into the pipeline
  - CDK Aspects for Policy/Compliance Enforcement
  - CloudWatch Monitoring: Metrics, Alarms, Actions
  - Amazon SNS: Topics for notifications

- [Lab 6: Refactor to Fargate + CloudFront Static Site](./lab-6a/README.md)
  - Containers & Docker Basics: Dockerfile, Build, Tag, Push
  - Amazon ECR & Amazon ECS/Fargate: Concepts and implementation
  - S3 Static Website Hosting & Amazon CloudFront: CDN basics

## Workshop Materials

Each lab contains:
- README with concept overview and lab objectives
- Step-by-step instructions
- Code samples to copy/paste
- Architectural diagrams
- Exercise solutions


## Additional Resources

- [AWS CDK TypeScript Reference](https://docs.aws.amazon.com/cdk/api/latest/typescript/api/index.html)
- [GitLab CI/CD Documentation](https://docs.gitlab.com/ee/ci/)
- [Workshop Code Repository](https://github.com/tlaskowsky/cdk-gitlab-3day-workshop)
- [Cheat Sheets](./resources/cheatsheets/index.md)

---

© 2025 CredoSec