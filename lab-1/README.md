# Lab 1: Foundation + GitLab CI/CD Bootstrapping + VPC Import

## Time Allocation
Day 1 Morning (Approximately 2-3 hours)

## Incremental Objective
Establish the basic CDK project structure, CI/CD to the Dev environment, and a minimal working event pipeline (S3 → SQS → EC2 placeholder) within an existing VPC.

## Key Concepts

- **CDK Fundamentals**: App, Stacks, Constructs (L1/L2/L3)
- **TypeScript in CDK**: Props Interfaces for Type Safety
- **AWS Core Services**: S3, SQS, EC2, VPC
- **Importing Existing AWS Infrastructure**: Vpc.fromLookup()
- **Connecting Stacks**: Cross-Stack References via Props
- **Basic CI/CD**: GitLab CI/CD Basics (.gitlab-ci.yml, Stages, Jobs, Runners)
- **Simple Automation**: Intro to CDK Aspects for Tagging
- **Event-Driven Pattern**: SQS Trigger Intro (Conceptual)
- **Compute Provisioning**: Basic EC2 with UserData

## Lab Overview

In this lab, you will:

1. Initialize a TypeScript CDK project in GitLab
2. Define a CoreStack containing S3 and SQS resources
3. Define a ComputeStack with an EC2 instance that polls SQS
4. Import an existing VPC using Vpc.fromLookup()
5. Connect stacks by passing resources as props
6. Implement a basic tagging aspect
7. Create a GitLab CI/CD pipeline (.gitlab-ci.yml)
8. Deploy to the Dev environment
9. Test the deployment by sending a message to SQS

## Prerequisites

- AWS account with admin access
- GitLab account with ability to create projects
- Working knowledge of AWS services (S3, SQS, EC2, VPC)
- Basic understanding of CDK concepts
- Familiarity with TypeScript

## Hands-on Lab Instructions
[Lab 1: Foundation & CI/CD Bootstrapping](lab-1)]

## Next Steps

In [Lab 2](../lab-2/README.md), you'll extend this foundation by implementing cross-account CI/CD and resource prefixing.