---
layout: default
title: Lab 5 Automated Tests + Infrastructure Compliance
nav_order: 50
has_children: true
---

# Lab 5: Automated Tests + Infrastructure Compliance

## Time Allocation
Day 3 Morning (Approximately 2.5-3 hours)

## Incremental Objective
Enhance pipeline robustness, maintainability, and security posture by adding automated tests to the CI/CD process and enforcing infrastructure best practices using CDK Aspects.

## Key Concepts

- **Testing Infrastructure as Code**: Unit, Snapshot, and Integration testing
- **CDK Assertions Module**: Template validation and resource verification
- **Jest for Testing**: Test frameworks and snapshot comparison
- **CI/CD Test Integration**: Adding test stages to pipelines
- **CDK Aspects**: Policy and compliance enforcement
- **Infrastructure Quality**: Security, reliability, and operational excellence

## Lab Overview

In this lab, you will:

1. Set up a Jest testing environment for CDK
2. Write unit tests for your stack resources:
   - Verify resource creation
   - Test specific properties (encryption, instance types, etc.)
   - Create snapshot tests
3. Implement advanced compliance aspects:
   - Enforce encryption on SQS queues
   - Require point-in-time recovery for DynamoDB
   - Check S3 bucket versioning
   - Validate other security best practices
4. Integrate tests into your GitLab CI/CD pipeline
5. Add a test stage that runs before deployment
6. Deploy and verify security compliance

## Prerequisites

- Completion of Lab 4
- Basic understanding of testing principles
- Familiarity with Jest or similar testing frameworks
- Knowledge of AWS security best practices

## Next Steps

In [Lab 6](../lab-6/README.md), you'll refactor the compute layer to use containerized ECS Fargate tasks, add operational monitoring, and expose the system's status via a CloudFront static site.