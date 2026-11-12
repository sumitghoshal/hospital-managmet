terraform {
  required_version = ">= 1.6"
  required_providers {
    aws  = { source = "hashicorp/aws", version = "~> 5.70" }
    helm = { source = "hashicorp/helm", version = "~> 2.15" }
  }
  # Recommended: store state remotely
  # backend "s3" { bucket = "YOUR-TFSTATE-BUCKET" key = "hms/terraform.tfstate" region = "ap-southeast-2" }
}

provider "aws" {
  region = var.region
  default_tags { tags = { Project = var.project, ManagedBy = "terraform" } }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
    }
  }
}
