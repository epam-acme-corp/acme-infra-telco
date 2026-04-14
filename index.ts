import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";
import * as k8s from "@pulumi/kubernetes";

const config = new pulumi.Config();
const location = config.get("location") ?? "eastus";
const hubVnetResourceId = config.require("hubVnetResourceId");
const postgresAdminLogin = config.get("postgresAdminLogin") ?? "acmepsqladmin";
const postgresAdminPassword = config.requireSecret("postgresAdminPassword");

const rg = new azure.resources.ResourceGroup("rg-acme-telco-prod", {
  resourceGroupName: "rg-acme-telco-prod",
  location,
});

const spokeVnet = new azure.network.VirtualNetwork("vnet-acme-telco-prod", {
  resourceGroupName: rg.name,
  location: rg.location,
  virtualNetworkName: "vnet-acme-telco-prod",
  addressSpace: { addressPrefixes: ["10.5.0.0/16"] },
});

const aksSystemSubnet = new azure.network.Subnet("snet-aks-system", {
  resourceGroupName: rg.name,
  virtualNetworkName: spokeVnet.name,
  subnetName: "snet-aks-system",
  addressPrefix: "10.5.0.0/22",
});

const aksWorkloadSubnet = new azure.network.Subnet("snet-aks-workload", {
  resourceGroupName: rg.name,
  virtualNetworkName: spokeVnet.name,
  subnetName: "snet-aks-workload",
  addressPrefix: "10.5.4.0/22",
});

const aksHighCpuSubnet = new azure.network.Subnet("snet-aks-highcpu", {
  resourceGroupName: rg.name,
  virtualNetworkName: spokeVnet.name,
  subnetName: "snet-aks-highcpu",
  addressPrefix: "10.5.8.0/22",
});

const databasesSubnet = new azure.network.Subnet("snet-databases", {
  resourceGroupName: rg.name,
  virtualNetworkName: spokeVnet.name,
  subnetName: "snet-databases",
  addressPrefix: "10.5.16.0/24",
  delegations: [
    {
      name: "postgresql-flexible-servers",
      serviceName: "Microsoft.DBforPostgreSQL/flexibleServers",
    },
  ],
});

const privateEndpointsSubnet = new azure.network.Subnet("snet-private-endpoints", {
  resourceGroupName: rg.name,
  virtualNetworkName: spokeVnet.name,
  subnetName: "snet-private-endpoints",
  addressPrefix: "10.5.17.0/24",
  privateEndpointNetworkPolicies: "Disabled",
});

new azure.network.VirtualNetworkPeering("peer-telco-to-hub", {
  resourceGroupName: rg.name,
  virtualNetworkName: spokeVnet.name,
  virtualNetworkPeeringName: "peer-telco-to-hub",
  remoteVirtualNetwork: { id: hubVnetResourceId },
  allowVirtualNetworkAccess: true,
  allowForwardedTraffic: true,
  allowGatewayTransit: false,
  useRemoteGateways: true,
});

const psqlPrivateDns = new azure.network.PrivateZone("pdns-postgres", {
  resourceGroupName: rg.name,
  privateZoneName: "privatelink.postgres.database.azure.com",
  location: "global",
});

new azure.network.VirtualNetworkLink("pdns-postgres-link", {
  resourceGroupName: rg.name,
  privateZoneName: psqlPrivateDns.name,
  virtualNetworkLinkName: "pdns-postgres-link",
  virtualNetwork: { id: spokeVnet.id },
  registrationEnabled: false,
});

const aks = new azure.containerservice.ManagedCluster("aks-acme-telco-prod", {
  resourceGroupName: rg.name,
  resourceName: "aks-acme-telco-prod",
  location: rg.location,
  dnsPrefix: "aks-acme-telco-prod",
  kubernetesVersion: "1.30",
  identity: { type: "SystemAssigned" },
  sku: { name: "Base", tier: "Standard" },
  enableRBAC: true,
  aadProfile: {
    managed: true,
    enableAzureRBAC: true,
  },
  oidcIssuerProfile: {
    enabled: true,
  },
  securityProfile: {
    workloadIdentity: { enabled: true },
  },
  networkProfile: {
    networkPlugin: "azure",
    networkPluginMode: "overlay",
    podCidr: "172.16.0.0/16",
    serviceCidr: "10.6.0.0/16",
    dnsServiceIP: "10.6.0.10",
    outboundType: "userDefinedRouting",
    loadBalancerSku: "standard",
  },
  agentPoolProfiles: [
    {
      name: "system",
      mode: "System",
      vmSize: "Standard_D4s_v5",
      osType: "Linux",
      osSKU: "AzureLinux",
      type: "VirtualMachineScaleSets",
      vnetSubnetID: aksSystemSubnet.id,
      enableAutoScaling: true,
      minCount: 2,
      maxCount: 5,
      count: 2,
    },
  ],
  autoScalerProfile: {
    balanceSimilarNodeGroups: "true",
    expander: "least-waste",
    maxGracefulTerminationSec: "600",
    scanInterval: "20s",
    skipNodesWithLocalStorage: "false",
  },
});

new azure.containerservice.AgentPool("np-workload", {
  resourceGroupName: rg.name,
  resourceName: aks.name,
  agentPoolName: "workload",
  mode: "User",
  vmSize: "Standard_D8s_v5",
  osType: "Linux",
  osSKU: "AzureLinux",
  type: "VirtualMachineScaleSets",
  vnetSubnetID: aksWorkloadSubnet.id,
  enableAutoScaling: true,
  minCount: 3,
  maxCount: 10,
  count: 3,
});

new azure.containerservice.AgentPool("np-highcpu", {
  resourceGroupName: rg.name,
  resourceName: aks.name,
  agentPoolName: "highcpu",
  mode: "User",
  vmSize: "Standard_F16s_v2",
  osType: "Linux",
  osSKU: "AzureLinux",
  type: "VirtualMachineScaleSets",
  vnetSubnetID: aksHighCpuSubnet.id,
  enableAutoScaling: true,
  minCount: 2,
  maxCount: 6,
  count: 2,
  nodeLabels: {
    "workload-profile": "rating-charging-highcpu",
  },
  nodeTaints: ["workload-profile=rating-charging-highcpu:NoSchedule"],
});

const namespaceDefinitions = [
  { name: "billing-mediation", short: "med" },
  { name: "rating-charging", short: "rating" },
  { name: "crm-integration", short: "crm" },
  { name: "self-service", short: "selfservice" },
  { name: "network-monitoring", short: "monitoring" },
  { name: "service-provisioning", short: "provisioning" },
  { name: "fault-management", short: "fault" },
];

const namespaceIdentities = namespaceDefinitions.map((ns) =>
  new azure.managedidentity.UserAssignedIdentity(`id-acme-telco-${ns.short}`, {
    resourceGroupName: rg.name,
    location: rg.location,
    resourceName: `id-acme-telco-${ns.short}`,
  }),
);

const kubeConfig = pulumi
  .all([rg.name, aks.name])
  .apply(([resourceGroupName, resourceName]) =>
    azure.containerservice
      .listManagedClusterUserCredentials({
        resourceGroupName,
        resourceName,
      })
      .then((creds) => Buffer.from(creds.kubeconfigs[0].value, "base64").toString()),
  );

const k8sProvider = new k8s.Provider("k8s-provider", {
  kubeconfig: kubeConfig,
});

namespaceDefinitions.forEach((ns) => {
  new k8s.core.v1.Namespace(
    ns.name,
    {
      metadata: {
        name: ns.name,
      },
    },
    { provider: k8sProvider, dependsOn: [aks] },
  );
});

const postgresSku = { name: "GP_Standard_D4s_v3", tier: "GeneralPurpose" };
const postgresVersion = "15";

const postgresServers = [
  "psql-acme-telco-rating-prod",
  "psql-acme-telco-crm-prod",
  "psql-acme-telco-selfservice-prod",
  "psql-acme-telco-provisioning-prod",
  "psql-acme-telco-fault-prod",
];

postgresServers.forEach((serverName) => {
  new azure.dbforpostgresql.Server(serverName, {
    resourceGroupName: rg.name,
    location: rg.location,
    serverName,
    administratorLogin: postgresAdminLogin,
    administratorLoginPassword: postgresAdminPassword,
    version: postgresVersion,
    storage: {
      storageSizeGB: 256,
    },
    backup: {
      backupRetentionDays: 14,
      geoRedundantBackup: "Enabled",
    },
    network: {
      delegatedSubnetResourceId: databasesSubnet.id,
      privateDnsZoneArmResourceId: psqlPrivateDns.id,
    },
    highAvailability: {
      mode: "ZoneRedundant",
    },
    sku: postgresSku,
    authConfig: {
      activeDirectoryAuth: "Enabled",
      passwordAuth: "Enabled",
      tenantId: azure.authorization.getClientConfigOutput().tenantId,
    },
  });
});

const redis = new azure.cache.RedisEnterprise("redis-acme-telco-rating-prod", {
  resourceGroupName: rg.name,
  location: rg.location,
  clusterName: "redis-acme-telco-rating-prod",
  sku: {
    name: "Enterprise_E10",
    capacity: 2,
  },
  minimumTlsVersion: "1.2",
});

new azure.cache.Database("redis-acme-telco-rating-prod-default", {
  resourceGroupName: rg.name,
  clusterName: redis.name,
  databaseName: "default",
  clientProtocol: "Encrypted",
  clusteringPolicy: "EnterpriseCluster",
  evictionPolicy: "VolatileLRU",
  modules: [
    { name: "RedisBloom" },
    { name: "RediSearch" },
  ],
});

export const resourceGroupName = rg.name;
export const vnetName = spokeVnet.name;
export const aksName = aks.name;
export const identities = namespaceIdentities.map((identity) => identity.name);
export const postgresServerNames = postgresServers;
export const redisClusterName = redis.name;
