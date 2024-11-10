# Gitpod Runner Resource Analyzer

> [!WARNING]
> **Proof of Concept Only** ⚠️
> This is an **unofficial** tool and a proof of concept for analyzing Gitpod Flex's runner resources and costs. It is not an official Gitpod product and can change or break at any time without notice. Use at your own risk.

## Quick Start

1. Clone the repository:

```bash
git clone https://github.com/Siddhant-K-code/gitpod-runner-analyzer
cd gitpod-runner-analyzer
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
export GITPOD_PAT="your_personal_access_token"
export GITPOD_ORG_ID="your_organization_id"
```

4. Run the analyzer:

```bash
npx ts-node resource-analyzer.ts
```

## Output

The tool generates a Markdown report (`gitpod-resource-report.md`) containing:

- Runner inventory
- Environment distribution
- Basic cost estimation
- System details
- Usage recommendations

## Sample Usage

```typescript
import { generateResourceReport } from './resource-analyzer';

async function main() {
  const pat = process.env.GITPOD_PAT!;
  const orgId = process.env.GITPOD_ORG_ID!;

  await generateResourceReport(pat, orgId);
}
```

## Limitations

- Cost estimates are approximations
- Limited to current API capabilities
- May not capture all resource types
- No historical data analysis

> [!NOTE]
> This tool is currently in experimental stage and is not officially supported by Gitpod. APIs and functionality may change without notice.
