---
layout: default
title: Lab 3 AI (Comprehend) + DynamoDB + Custom Resource Seeding
nav_order: 30
has_children: true
---

# Lab 3: AI (Comprehend) + DynamoDB + Custom Resource Seeding

## Time Allocation
Day 2 Morning (Approximately 2.5-3 hours)

## Incremental Objective
Integrate persistence using DynamoDB, add the first AI service (Comprehend) for basic text analysis, and implement a CDK Custom Resource for automated database setup (seeding).

## Key Concepts

- **Amazon DynamoDB**: Core Concepts (Tables, Items, Keys - PK/SK, Capacity Modes)
- **IAM Permissions**: Granting EC2 access to DynamoDB and Comprehend
- **Amazon Comprehend**: Basic NLP Capabilities (Sentiment, Key Phrases)
- **CDK Custom Resources**: Lambda-backed Custom Resources, Provider Framework
- **Data Persistence**: Storing processing results in DynamoDB

## Lab Overview

In this lab, you will:

1. Add a DynamoDB table to your CoreStack
2. Implement permission grants for EC2 to access DynamoDB
3. Enhance the EC2 processing script to call Amazon Comprehend
4. Store Comprehend analysis results in DynamoDB
5. Create a Lambda function for database seeding
6. Implement a Custom Resource to automate seeding during deployment
7. Deploy and test the integration

## Prerequisites

- Completion of Lab 2
- Understanding of DynamoDB concepts (tables, items, keys)
- Basic knowledge of AWS AI services
- Familiarity with Lambda functions

## Next Steps

In [Lab 4](../lab-4/README.md), you'll complete the document processing pipeline by integrating Amazon Textract for document analysis and setting up real file ingestion from S3.