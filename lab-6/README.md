---
layout: default
title: Lab 6 Refactor to Fargate + Monitoring + CloudFront Static Site
nav_order: 60
has_children: true
---

# Lab 6: Refactor to Fargate + Monitoring + CloudFront Static Site

## Time Allocation
Day 3 Afternoon (Approximately 3 hours)

## Incremental Objective
Refactor the compute layer from EC2 to a scalable, containerized ECS Fargate service, add operational monitoring and alerting, and expose the system's status via a static web interface hosted on CloudFront.

## Key Concepts

- **Containers & Docker**: Dockerfile, build, tag, push process
- **Amazon ECR**: Container Registry for storing Docker images
- **Amazon ECS & Fargate**: Serverless container execution
- **CloudWatch Monitoring**: Metrics, alarms, and notifications
- **Amazon SNS**: Topic-based notifications
- **Amazon CloudFront**: Content delivery network for static sites
- **S3 Static Website Hosting**: Serving frontend content
- **CDK S3 Deployment**: BucketDeployment construct

## Lab Overview

In this lab, you will:

1. Containerize the document processing application:
   - Create a Dockerfile for the Node.js processor
   - Build and push to Amazon ECR
2. Refactor the compute stack:
   - Remove EC2 instance
   - Create an ECS Fargate service
   - Configure auto-scaling based on queue depth
3. Add monitoring and alerting:
   - Create an SNS topic for notifications
   - Configure CloudWatch alarms for SQS queue and Fargate metrics
4. Deploy a static website:
   - Create an S3 bucket for static content
   - Set up a CloudFront distribution
   - Deploy simple HTML/CSS files to show system status
5. Test the end-to-end solution
6. Deploy and verify all components

## Prerequisites

- Completion of Lab 5
- Basic knowledge of containers and Docker
- Understanding of CDN concepts
- Familiarity with monitoring and observability principles

## Final Result

By completing this lab, you will have built a complete, production-ready document processing pipeline with:

- Scalable, containerized compute using ECS Fargate
- AI-powered document analysis with Textract and Comprehend
- Persistent storage using DynamoDB
- Comprehensive monitoring and alerting
- User-friendly static interface via CloudFront
- End-to-end CI/CD automation with GitLab
- Infrastructure compliance and security best practices