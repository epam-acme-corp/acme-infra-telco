# acme-infra-telco

Pulumi TypeScript infrastructure for the Acme Telco spoke in `epam-acme-corp`.

## Provisioned resources

- Resource Group: `rg-acme-telco-prod`
- VNet: `vnet-acme-telco-prod` (`10.5.0.0/16`)
  - `snet-aks-system` (`10.5.0.0/22`)
  - `snet-aks-workload` (`10.5.4.0/22`)
  - `snet-aks-highcpu` (`10.5.8.0/22`)
  - `snet-databases` (`10.5.16.0/24`)
  - `snet-private-endpoints` (`10.5.17.0/24`)
- VNet peering from spoke to Hub VNet (`acme-infra-hub`)
- AKS: `aks-acme-telco-prod` (Kubernetes 1.30, Azure CNI Overlay, Workload Identity, Azure Linux)
  - System pool: `Standard_D4s_v5`, autoscale 2-5
  - Workload pool: `Standard_D8s_v5`, autoscale 3-10
  - High-CPU pool: `Standard_F16s_v2`, autoscale 2-6, tainted for rating/charging
- Kubernetes namespaces:
  - `billing-mediation`
  - `rating-charging`
  - `crm-integration`
  - `self-service`
  - `network-monitoring`
  - `service-provisioning`
  - `fault-management`
- User-assigned managed identities:
  - `id-acme-telco-med`
  - `id-acme-telco-rating`
  - `id-acme-telco-crm`
  - `id-acme-telco-selfservice`
  - `id-acme-telco-monitoring`
  - `id-acme-telco-provisioning`
  - `id-acme-telco-fault`
- PostgreSQL Flexible Servers:
  - `psql-acme-telco-rating-prod`
  - `psql-acme-telco-crm-prod`
  - `psql-acme-telco-selfservice-prod`
  - `psql-acme-telco-provisioning-prod`
  - `psql-acme-telco-fault-prod`
- Redis Enterprise: `redis-acme-telco-rating-prod`

## Not provisioned by this stack

- Oracle 19c is documented for on-prem/IaaS use and remains outside this IaC deployment.
- TimescaleDB is deployed inside AKS by application manifests (StatefulSet in `network-monitoring`), not as an Azure managed service in this project.

## Configuration

Set required Pulumi config values before running preview/apply:

```bash
pulumi config set location eastus
pulumi config set hubVnetResourceId /subscriptions/<subscription-id>/resourceGroups/<hub-rg>/providers/Microsoft.Network/virtualNetworks/vnet-acme-hub-prod
pulumi config set postgresAdminLogin acmepsqladmin
pulumi config set --secret postgresAdminPassword <password>
```

## Commands

```bash
npm install
npx tsc --noEmit
pulumi preview
pulumi up
```
