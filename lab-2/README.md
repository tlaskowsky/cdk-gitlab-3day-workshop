---
layout: default
title: Lab 2 Cross-Account CI/CD + Resource Prefixing
nav_order: 20
has_children: true
---

# Lab 2: Cross-Account CI/CD + Resource Prefixing

## Time Allocation
Day 1 Afternoon (Approximately 2-3 hours)

## Incremental Objective
Enable secure, automated deployment of the pipeline to a second (Prod) AWS account using GitLab CI/CD, and implement unique resource naming using CDK context to prevent collisions.

## Key Concepts

- **GitLab CI/CD Pipelines**: Cross-Account Deployment Strategy (using sts:AssumeRole)
- **GitLab CI/CD Features**: Manual Approvals/Gates, Environments
- **IAM for Cross-Account Access**: CDKDeployRole concept
- **CDK Context**: Passing configuration/parameters (-c key=value)
- **Resource Naming Strategies**: Importance and implementation techniques

## Lab Overview

In this lab, you will:

1. Modify your GitLab CI/CD pipeline to support cross-account deployment
2. Configure IAM roles for secure cross-account access
3. Add manual approval gates for production deployments
4. Implement CDK context for environment-specific configuration
5. Add resource prefixing to prevent name collisions
6. Deploy to both Dev and Prod environments

## Prerequisites

- Completion of Lab 1
- Access to a second AWS account (Prod)
- Understanding of IAM roles and cross-account permissions
- Basic knowledge of GitLab CI/CD pipelines

## Next Steps

In [Lab 3](../lab-3/README.md), you'll enhance your pipeline by adding DynamoDB for persistence, integrating AWS Comprehend, and implementing a custom resource for database seeding.