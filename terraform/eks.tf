module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.24"

  cluster_name    = "${var.project}-eks"
  cluster_version = var.k8s_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access           = var.public_api_endpoint
  cluster_endpoint_private_access          = true
  enable_cluster_creator_admin_permissions = true

  cluster_addons = {
    eks-pod-identity-agent = { most_recent = true } # enables Pod Identity
    coredns                = { most_recent = true }
    kube-proxy             = { most_recent = true }
    vpc-cni                = { most_recent = true }
    aws-ebs-csi-driver     = { most_recent = true }
  }

  eks_managed_node_groups = {
    default = {
      instance_types = ["t3.medium"]
      min_size       = 2
      max_size       = 3
      desired_size   = 2
      subnet_ids     = module.vpc.private_subnets
    }
  }
}
