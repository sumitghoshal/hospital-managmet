# 🏥 MediCare Hospital Management System (HMS)

Full-stack hospital management app deployed on **AWS EKS (ap-southeast-2)** using **Terraform**, **Route 53**, **ALB Ingress Controller**, **EKS Pod Identity**, **ArgoCD** (GitOps) and **GitHub Actions** (CI).

## Features
| Module | What it does |
|---|---|
| Animated login | Pulsing logo, ECG line animation, floating medical crosses, shake on error |
| Patients | Register and list patients |
| Appointments | OPD consultation, **special surgeon (surgery)** bookings, **daily/follow-up** visits, double-booking protection, complete/cancel |
| Laboratory | Order tests (CBC, Lipid, Thyroid, X-Ray, MRI …), enter **test results**, pending/ready status |
| Billing | Pay by **UPI** (txn ID), **Cash**, or **Card** (last 4 digits); collection per payment mode |
| Dashboard | Patients, today's appointments, upcoming surgeries, pending labs, today's collection |

**Login (hard-coded as requested):** `flexsumit` / `mh40ay7550`
(defined in `app/server.js`; override with env vars `ADMIN_USER`, `ADMIN_PASS`).

## Architecture
```
GitHub push ──► GitHub Actions ──► build image ──► ECR (ap-southeast-2)
                     │ (OIDC, no keys)                │
                     └─► commits new image tag to k8s/deployment.yaml
                                                      │
              ArgoCD (in EKS) watches repo ◄──────────┘ auto-sync
                     │
   Route 53 ◄─ ExternalDNS      ALB (public subnets, ACM HTTPS)
                                   │  AWS Load Balancer Controller (Ingress)
                          EKS pods in PRIVATE subnets ── Pod Identity ──► IAM roles
```
* **Private infrastructure:** worker nodes only in private subnets (NAT egress); only the ALB is public.
* **Pod Identity:** IAM roles for the LB controller, ExternalDNS, EBS CSI driver and the app (`hms/hms-app` → S3 lab-reports bucket) — no static AWS keys anywhere.

## Folder layout
```
app/                 Node.js + Express + SQLite app, public/index.html (UI), Dockerfile
k8s/                 Namespace, ServiceAccount, PVC, Deployment, Service, Ingress (ArgoCD syncs this)
argocd/application.yaml   ArgoCD Application
terraform/           VPC, EKS, Pod Identity, Route 53, ACM, ECR, GitHub OIDC, Helm (ALB ctrl, ExternalDNS, ArgoCD)
.github/workflows/ci-cd.yml
```

## Prerequisites
AWS CLI configured (admin-ish), Terraform ≥ 1.6, kubectl, Git, a **domain you own**, a GitHub repo.

## Deploy – step by step

### 1. Push this project to GitHub
```bash
git init && git add . && git commit -m "HMS" && git branch -M main
git remote add origin https://github.com/YOUR_USER/hospital-management.git && git push -u origin main
```
Replace `YOUR_GITHUB_USER` in `argocd/application.yaml` and in `terraform/terraform.tfvars` (`github_repo`). The domain **sumitops.online** is already set in `k8s/ingress.yaml` and `terraform/terraform.tfvars`. Commit and push.

### 2. Infrastructure with Terraform (region ap-southeast-2)
```bash
cd terraform
# terraform.tfvars already has domain_name = "sumitops.online" – just set github_repo
terraform init

# Phase 1 – create the hosted zone first
terraform apply -target=aws_route53_zone.main
terraform output route53_nameservers
```
➡ At the registrar where you bought **sumitops.online**, switch it to *Custom nameservers* and enter those 4 `ns-xxx.awsdns-xx...` values (no trailing dot, turn DNSSEC off). Then wait until this shows the AWS servers (5–60 min):
```bash
dig NS sumitops.online +short
```
Do **not** run phase 2 before that. If sumitops.online already has a Route 53 hosted zone in your account, set `create_hosted_zone = false` in `terraform.tfvars` and skip phase 1.
```bash
# Phase 2 – everything else (~15-20 min)
terraform apply
```

### 3. Connect kubectl and install the ArgoCD app
```bash
$(terraform output -raw kubeconfig_command)
kubectl get nodes
kubectl apply -f ../argocd/application.yaml
```

### 4. GitHub secret for CI
GitHub repo → Settings → Secrets → Actions → add `AWS_ROLE_ARN` = `terraform output github_actions_role_arn`.

### 5. First image build
Push any change under `app/` (or run the workflow manually). Actions builds → pushes to ECR → updates `k8s/deployment.yaml` → ArgoCD deploys. Check:
```bash
kubectl -n hms get pods,ingress
```
Open **https://hms.sumitops.online** (ExternalDNS creates the Route 53 record from the Ingress automatically).

### ArgoCD UI
```bash
kubectl -n argocd port-forward svc/argocd-server 8080:443
$(terraform output -raw argocd_password_command)     # password for user "admin"
```
Open https://localhost:8080.

## Run locally
```bash
cd app && npm install && npm start      # http://localhost:3000
```

## Troubleshooting sumitops.online
| Symptom | Cause / fix |
|---|---|
| `terraform apply` fails at `aws_acm_certificate_validation` after 20 min | Nameservers at the registrar don't point to Route 53 yet. Fix them, check `dig NS sumitops.online +short`, run `terraform apply` again. |
| Site says DNS_PROBE / "can't find server" | ExternalDNS record missing: `kubectl -n kube-system logs deploy/external-dns`. Make sure the Ingress host equals `hms.sumitops.online`. |
| Two hosted zones for the domain / wrong NS | Use `create_hosted_zone = false`, or delete the extra zone and use the NS of the one Terraform manages. |
| `kubectl get ingress -n hms` shows no ADDRESS | ALB controller can't build the ALB: `kubectl -n kube-system logs deploy/aws-load-balancer-controller`. Usually the certificate was not ISSUED yet when the Ingress was created; fix: `kubectl -n hms delete ingress hms` and let ArgoCD re-create it. |
| Browser certificate warning | Ingress host differs from the ACM certificate host (`terraform output certificate_arn`). Both must be `hms.sumitops.online`. |
| Want `https://sumitops.online` (no `hms.`) | Set `app_subdomain = ""` in tfvars and change the 3 hosts in `k8s/ingress.yaml` to `sumitops.online`. |

## Application URL
**https://hms.sumitops.online** (also printed by `terraform output app_url`). There is no live URL until you run the steps above in **your** AWS account.

## Security notes (read before going live)
1. Hard-coded credentials are in source control. Fine for a demo; for real use set `ADMIN_USER`/`ADMIN_PASS`/`TOKEN_SECRET` from a Kubernetes Secret / AWS Secrets Manager and add per-role users.
2. UPI/Card entries record a **reference only** (txn ID / last 4). Real gateways (Razorpay etc.) are needed for live collection; never store full card numbers.
3. Set `public_api_endpoint = false` for a fully private EKS API (needs VPN/bastion/self-hosted runner).
4. SQLite on one EBS volume ⇒ 1 replica. For HA, move to Amazon RDS PostgreSQL.
5. Patient data is sensitive: enable backups (EBS snapshots/RDS), audit logging and follow applicable health-data laws.

## Cost / cleanup
EKS control plane + 2×t3.medium + NAT + ALB ≈ a few hundred USD/month. Remove with:
```bash
kubectl delete -f argocd/application.yaml   # lets ALB + DNS record be cleaned up first
cd terraform && terraform destroy
```
