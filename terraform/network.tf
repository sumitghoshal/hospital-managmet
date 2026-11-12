data "aws_availability_zones" "az" { state = "available" }

locals {
  azs  = slice(data.aws_availability_zones.az.names, 0, 2)
  host = var.app_subdomain == "" ? var.domain_name : "${var.app_subdomain}.${var.domain_name}"
}

# Private infrastructure: worker nodes live ONLY in private subnets (egress through NAT).
# Only the ALB sits in public subnets.
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.13"

  name = "${var.project}-vpc"
  cidr = "10.20.0.0/16"
  azs  = local.azs

  private_subnets = ["10.20.1.0/24", "10.20.2.0/24"]
  public_subnets  = ["10.20.101.0/24", "10.20.102.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true

  public_subnet_tags  = { "kubernetes.io/role/elb" = 1 }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = 1 }
}
