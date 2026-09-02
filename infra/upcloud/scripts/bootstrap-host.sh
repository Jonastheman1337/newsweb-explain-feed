#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run bootstrap-host.sh as root." >&2
  exit 1
fi

deploy_user="autoweb"
harden_ssh=false
if [[ ${1:-} == "--harden-ssh" ]]; then
  harden_ssh=true
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg openssl sudo unattended-upgrades python3

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

. /etc/os-release
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${VERSION_CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if ! id -u "${deploy_user}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${deploy_user}"
fi
usermod -aG docker,sudo "${deploy_user}"

cat >"/etc/sudoers.d/90-${deploy_user}" <<EOF
${deploy_user} ALL=(ALL:ALL) NOPASSWD:ALL
EOF
chmod 0440 "/etc/sudoers.d/90-${deploy_user}"
visudo -cf "/etc/sudoers.d/90-${deploy_user}" >/dev/null

install -d -m 0700 -o "${deploy_user}" -g "${deploy_user}" "/home/${deploy_user}/.ssh"
if [[ -s /root/.ssh/authorized_keys && ! -s "/home/${deploy_user}/.ssh/authorized_keys" ]]; then
  install -m 0600 -o "${deploy_user}" -g "${deploy_user}" /root/.ssh/authorized_keys "/home/${deploy_user}/.ssh/authorized_keys"
fi

install -d -m 0750 -o "${deploy_user}" -g "${deploy_user}" \
  /srv/autoweb \
  /srv/autoweb/releases \
  /srv/autoweb/backups \
  /srv/autoweb/state \
  /srv/autoweb/tmp
install -d -m 0700 -o "${deploy_user}" -g "${deploy_user}" /srv/autoweb/secrets

if ! swapon --show=NAME --noheadings | grep -q .; then
  if [[ ! -e /swapfile ]]; then
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
fi
if ! grep -qE '^/swapfile\s' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
cat >/etc/sysctl.d/99-autoweb.conf <<'EOF'
vm.swappiness=10
EOF
sysctl --system >/dev/null

install -d -m 0755 /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
EOF
systemctl enable --now docker
systemctl restart docker

dpkg-reconfigure -f noninteractive unattended-upgrades

if [[ "${harden_ssh}" == true ]]; then
  if [[ ! -s "/home/${deploy_user}/.ssh/authorized_keys" ]]; then
    echo "Refusing to harden SSH: ${deploy_user} has no authorized key." >&2
    exit 1
  fi
  cat >/etc/ssh/sshd_config.d/99-autoweb-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin no
PubkeyAuthentication yes
AllowUsers autoweb
EOF
  sshd -t
  systemctl reload ssh
fi

echo "Host bootstrap complete. Verify SSH as ${deploy_user} before running with --harden-ssh."
