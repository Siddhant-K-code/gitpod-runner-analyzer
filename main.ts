import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import { format } from 'date-fns';

// Updated interface based on actual API response
interface Runner {
  runner_id: string;
  name: string;
  kind: 'RUNNER_KIND_LOCAL' | 'RUNNER_KIND_REMOTE';
  created_at: {
    seconds: string;
    nanos: number;
  };
  updated_at: {
    seconds: string;
    nanos: number;
  };
  spec: {
    desired_phase: string;
    configuration: {
      region: string;
      release_channel: string;
      auto_update: boolean;
    };
  };
  status: {
    updated_at: {
      seconds: string;
      nanos: number;
    };
    version: string;
    system_details: string;
    phase: string;
    region: string;
    message: string;
    additional_info: Array<{
      name: string;
      value: string;
    }>;
  };
}

interface Environment {
  environment_id: string;
  context_url: string;
  runner_id: string;
  status: {
    phase: string;
    instance_id?: string;
  };
}

interface RunnerMetrics {
  runnerId: string;
  name: string;
  kind: string;
  region: string;
  uptime: number;
  phase: string;
  systemDetails: any;
  environments: Environment[];
  estimatedCost?: number;
}

class GitpodResourceAnalyzer {
  private client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly organizationId: string;

  constructor(pat: string, organizationId: string, baseUrl: string = 'https://app.gitpod.io/api') {
    this.baseUrl = baseUrl;
    this.organizationId = organizationId;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Content-Type': 'application/json'
      }
    });
  }

  private async listRunners(): Promise<Runner[]> {
    try {
      console.log('Calling ListRunners API...');
      const response = await this.client.post('/gitpod.v1.RunnerService/ListRunners', {
        organization_id: this.organizationId,
        pagination: {
          page_size: 100
        }
      });
      console.log('ListRunners Response:', JSON.stringify(response.data, null, 2));
      return response.data.runners || [];
    } catch (error) {
      console.error('Error fetching runners:', error);
      throw error;
    }
  }

  private async listEnvironments(): Promise<Environment[]> {
    try {
      console.log('Calling ListEnvironments API...');
      const response = await this.client.post('/gitpod.v1.EnvironmentService/ListEnvironments', {
        organization_id: this.organizationId,
        pagination: {
          page_size: 100
        }
      });
      console.log('ListEnvironments Response:', JSON.stringify(response.data, null, 2));
      return response.data.environments || [];
    } catch (error) {
      console.error('Error fetching environments:', error);
      throw error;
    }
  }

  private async getRunnerDetails(runnerId: string): Promise<Runner> {
    try {
      const response = await this.client.post('/gitpod.v1.RunnerService/GetRunner', {
        organization_id: this.organizationId,
        runner_id: runnerId
      });
      return response.data.runner;
    } catch (error) {
      console.error(`Error fetching runner details for ${runnerId}:`, error);
      throw error;
    }
  }

  private calculateUptime(createdAt: { seconds: string; nanos: number }): number {
    if (!createdAt || !createdAt.seconds) {
      return 0;
    }
    const created = new Date(Number(createdAt.seconds) * 1000);
    const now = new Date();
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60)); // Hours
  }

  private parseSystemDetails(details: string): any {
    if (!details) return {};
    try {
      return JSON.parse(details);
    } catch {
      return { raw: details };
    }
  }

  private getRegion(runner: Runner): string {
    return runner.status?.region ||
           runner.spec?.configuration?.region ||
           'unknown';
  }

  private estimateCost(metrics: RunnerMetrics): number {
    if (metrics.kind === 'RUNNER_KIND_LOCAL') return 0;

    // AWS cost estimation
    const hourlyRates: { [key: string]: number } = {
      't3.medium': 0.0416,
      't3.large': 0.0832,
      't3.xlarge': 0.1664,
      'default': 0.0416 // Default rate if instance type is unknown
    };

    const instanceType = metrics.systemDetails?.instanceType || 'default';
    const hourlyRate = hourlyRates[instanceType] || hourlyRates.default;

    // Cost calculation
    let cost = metrics.uptime * hourlyRate;

    // Add cost for environments
    const environmentCost = metrics.environments.length * 0.1 * metrics.uptime;

    return Number((cost + environmentCost).toFixed(2)) || 0;
  }

  private async analyzeRunner(runner: Runner, environments: Environment[]): Promise<RunnerMetrics> {
    const uptime = this.calculateUptime(runner.created_at);
    const systemDetails = this.parseSystemDetails(runner.status?.system_details);

    const runnerEnvironments = environments.filter(env => env.runner_id === runner.runner_id) || [];

    const metrics: RunnerMetrics = {
      runnerId: runner.runner_id || 'unknown',
      name: runner.name || 'Unnamed Runner',
      kind: runner.kind || 'unknown',
      region: this.getRegion(runner),
      uptime: uptime || 0,
      phase: runner.status?.phase || 'unknown',
      systemDetails,
      environments: runnerEnvironments
    };

    metrics.estimatedCost = this.estimateCost(metrics);
    return metrics;
  }

  private generateMarkdownReport(metrics: RunnerMetrics[]): string {
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    const totalCost = metrics.reduce((sum, m) => sum + (m.estimatedCost || 0), 0);
    const remoteCount = metrics.filter(m => m.kind === 'RUNNER_KIND_REMOTE').length;
    const localCount = metrics.filter(m => m.kind === 'RUNNER_KIND_LOCAL').length;
    const totalEnvironments = metrics.reduce((sum, m) => sum + m.environments.length, 0);

    let markdown = `# Gitpod Resource Usage Report
Generated: ${timestamp}

## Summary
- Total Runners: ${metrics.length}
  - Remote Runners: ${remoteCount}
  - Local Runners: ${localCount}
- Total Active Environments: ${totalEnvironments}
- Total Estimated Cost: $${totalCost.toFixed(2)}

## Cost Analysis
- Remote Runner Costs: $${metrics
  .filter(m => m.kind === 'RUNNER_KIND_REMOTE')
  .reduce((sum, m) => sum + (m.estimatedCost || 0), 0).toFixed(2)}
- Environment Costs: $${(totalEnvironments * 0.1).toFixed(2)}/hour

## Runner Details

| Name | Type | Region | Phase | Environments | Uptime (hrs) | Est. Cost ($) |
|------|------|--------|-------|--------------|--------------|---------------|
${metrics.map(m => `| ${m.name} | ${m.kind} | ${m.region} | ${m.phase} | ${m.environments.length} | ${m.uptime} | ${m.estimatedCost?.toFixed(2) || '0.00'} |`).join('\n')}

## Environment Distribution\n`;

    metrics.filter(m => m.environments.length > 0).forEach(m => {
      markdown += `
### ${m.name} (${m.runnerId})
Total Environments: ${m.environments.length}

| Environment ID | Context URL | Status |
|---------------|-------------|---------|
${m.environments.map(env =>
  `| ${env.environment_id || 'N/A'} | ${env.context_url || 'N/A'} | ${env.status?.phase || 'N/A'} |`
).join('\n')}
`;
    });

    markdown += `\n## System Details\n`;

    metrics.forEach(m => {
      markdown += `\n### ${m.name} (${m.runnerId})
- **Type:** ${m.kind}
- **Region:** ${m.region}
- **Phase:** ${m.phase}
- **Active Environments:** ${m.environments.length}
- **Uptime:** ${m.uptime} hours
- **System Details:**
\`\`\`json
${JSON.stringify(m.systemDetails, null, 2)}
\`\`\`\n`;
    });

    // Add recommendations
    markdown += `\n## Recommendations\n`;

    const inactiveRunners = metrics.filter(m => m.phase === 'RUNNER_PHASE_INACTIVE');
    const highUptimeRunners = metrics.filter(m => m.uptime > 168);
    const emptyRunners = metrics.filter(m => m.environments.length === 0 && m.uptime > 24);
    const highCostRunners = metrics.filter(m => (m.estimatedCost || 0) > 100);

    if (inactiveRunners.length > 0) {
      markdown += `- 🔴 Clean up ${inactiveRunners.length} inactive runners\n`;
    }
    if (highUptimeRunners.length > 0) {
      markdown += `- 🟡 Review ${highUptimeRunners.length} runners with high uptime (>1 week)\n`;
    }
    if (emptyRunners.length > 0) {
      markdown += `- 🟡 Consider removing ${emptyRunners.length} runners with no environments (>24h uptime)\n`;
    }
    if (highCostRunners.length > 0) {
      markdown += `- 🔴 Investigate ${highCostRunners.length} high-cost runners (>$100)\n`;
    }

    return markdown;
  }

  public async generateResourceReport(outputPath: string = './gitpod-resource-report.md'): Promise<void> {
    try {
      console.log(`Analyzing resources for organization: ${this.organizationId}`);
      console.log('Fetching runners...');
      const runners = await this.listRunners();

      console.log('Fetching environments...');
      const environments = await this.listEnvironments();

      console.log('Analyzing resources...');
      const metrics = await Promise.all(runners.map(r => this.analyzeRunner(r, environments)));

      console.log('Generating report...');
      const report = this.generateMarkdownReport(metrics);

      fs.writeFileSync(outputPath, report);
      console.log(`Report generated successfully at: ${outputPath}`);
    } catch (error) {
      console.error('Error generating report:', error);
      throw error;
    }
  }
}

// Example usage
export async function generateResourceReport(pat: string, organizationId: string): Promise<void> {
  const analyzer = new GitpodResourceAnalyzer(pat, organizationId);
  await analyzer.generateResourceReport();
}

// If running directly
if (require.main === module) {
  const pat = process.env.GITPOD_PAT;
  const organizationId = process.env.GITPOD_ORG_ID;

  if (!pat) {
    console.error('Please set GITPOD_PAT environment variable');
    process.exit(1);
  }

  if (!organizationId) {
    console.error('Please set GITPOD_ORG_ID environment variable');
    process.exit(1);
  }

  generateResourceReport(pat, organizationId)
    .then(() => console.log('Report generation completed'))
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}
