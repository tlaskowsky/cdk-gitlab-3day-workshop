---
layout: default
title: Lab 4 AI Event Pipeline Complete (Textract + Real File Ingestion)
nav_order: 40
has_children: true
---

# Lab 4: Event Pipeline Complete (Textract + Real File Ingestion)

## Time Allocation
Day 2 Afternoon (Approximately 2.5-3 hours)

## Incremental Objective
Complete the core document processing logic by integrating Textract for actual document analysis (PDF/image), creating a fully functional EC2-based pipeline from upload to results storage.

## Key Concepts

- **Amazon Textract**: Document Analysis Capabilities (Sync/Async OCR, Forms, Tables)
- **Integrating Multiple AI Services**: Combining Textract and Comprehend
- **CloudWatch Logs**: EC2 logging and monitoring
- **IAM Permissions**: Service access policies for Textract
- **End-to-End Event Processing**: S3 → SQS → EC2 → DynamoDB pipeline

## Lab Overview

In this lab, you will:

1. Grant EC2 permissions to access Amazon Textract
2. Enhance the EC2 processing script to:
   - Download documents from S3
   - Call Textract to extract text from documents
   - Process the Textract response
   - Optionally pass extracted text to Comprehend
   - Store structured results in DynamoDB
3. Implement detailed logging for debugging and monitoring
4. Test the complete document processing pipeline
5. Deploy and verify end-to-end functionality

## Prerequisites

- Completion of Lab 3
- Understanding of document processing concepts
- Familiarity with AWS AI/ML services
- Basic knowledge of event-driven architectures

## Next Steps

In [Lab 5](../lab-5/README.md), you'll enhance pipeline robustness and maintainability by adding automated tests and implementing infrastructure compliance checks using CDK Aspects.