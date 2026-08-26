# [Project Name] Design Document

- **Purpose:** [What the reader can build or review from this, and what it covers, in one sentence.]
- **For:** [Who this design is written for.]
- **Version:** [Version or date.]
- **Instead of this:** [Link the design that may suit the reader better and say when to read it, or delete this line.]

## Contents

- [1. Executive Summary](#1-executive-summary)
- [2. System Architecture](#2-system-architecture)
- [3. Data Model](#3-data-model)
- [4. API Design](#4-api-design)
- [5. Security Model](#5-security-model)
- [6. Deployment Plan](#6-deployment-plan)

## 1. Executive Summary

[Summarise the reader need, proposed design, and expected outcome.]

## 2. System Architecture

### 2.1. Component Diagram

[Insert a diagram or describe each component and its responsibility.]

### 2.2. Interaction Flow

[Describe the main request and response flow.]

#### 2.2.1. Authentication Sequence

[Describe sign-in, token validation, and failure handling.]

## 3. Data Model

### 3.1. Entities and Relationships

[Name the narrowest width each table below must survive. Where none is known, use labelled records instead.]

| Entity | Purpose | Relationships |
| :--- | :--- | :--- |
| **[Entity]** | [Purpose] | [Related entities] |

### 3.2. Data Lifecycle

[Describe how data enters, changes, persists, and leaves the system.]

## 4. API Design

### 4.1. Endpoints

| Method | Path | Purpose | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `[METHOD]` | `[path]` | [Purpose] | [Request shape] | [Response shape] |

### 4.2. Error Handling

[Define error categories, response shapes, and retry behaviour.]

## 5. Security Model

### 5.1. Threats and Controls

| Threat | Control | Residual risk |
| :--- | :--- | :--- |
| **[Threat]** | [Control] | [Residual risk] |

### 5.2. Access Control

[Define roles, permissions, and enforcement points.]

## 6. Deployment Plan

### 6.1. Environments

[Describe each environment and its release criteria.]

### 6.2. Rollout and Rollback

1. [Prepare and verify the release.]
2. [Deploy the change in controlled stages.]
3. [Verify success or follow the rollback procedure.]
