#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Student Panel - Linux / macOS bootstrap.
#
# Run it with:   ./setup.sh       (from the project root)
#
# It makes sure Node.js (>=20) and PostgreSQL are installed (using your system
# package manager, with sudo where needed), makes sure the database server is
# running, then hands off to scripts/setup.mjs, which configures the database,
# builds the app, starts it, and opens your browser. Safe to re-run.
# ---------------------------------------------------------------------------
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Colours (fall back to plain text when not a terminal).
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"; RESET="$(printf '\033[0m')"
  GREEN="$(printf '\033[32m')"; RED="$(printf '\033[31m')"; YELLOW="$(printf '\033[33m')"
else
  BOLD=""; DIM=""; RESET=""; GREEN=""; RED=""; YELLOW=""
fi
say()  { printf '%s\n' "$*"; }
head() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }
ok()   { printf '%s  ok %s%s\n' "$GREEN" "$*" "$RESET"; }
info() { printf '%s  %s%s\n' "$DIM" "$*" "$RESET"; }
warn() { printf '%s  ! %s%s\n' "$YELLOW" "$*" "$RESET"; }
die()  { printf '\n%sSetup stopped: %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# sudo only if we are not already root and sudo exists.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
fi

OS="$(uname -s)"
have() { command -v "$1" >/dev/null 2>&1; }
node_major() { have node && node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0; }

head "Student Panel - bootstrap ($OS)"
info "Project root: $DIR"
# --- detect the package manager -------------------------------------------
PM=""
if [ "$OS" = "Darwin" ]; then
  PM="brew"
elif have apt-get; then PM="apt"
elif have dnf;    then PM="dnf"
elif have yum;    then PM="yum"
elif have pacman; then PM="pacman"
elif have zypper; then PM="zypper"
fi

# --- Node.js >= 20 ---------------------------------------------------------
install_node() {
  head "Installing Node.js 20+"
  case "$PM" in
    brew)
      have brew || die "Homebrew is required on macOS. Install it from https://brew.sh and re-run."
      brew install node
      ;;
    apt)
      have curl || $SUDO apt-get install -y curl
      curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
      $SUDO apt-get install -y nodejs
      ;;
    dnf|yum)
      have curl || $SUDO "$PM" install -y curl
      curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO -E bash -
      $SUDO "$PM" install -y nodejs
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm nodejs npm
      ;;
    zypper)
      $SUDO zypper install -y nodejs20 || $SUDO zypper install -y nodejs
      ;;
    *)
      die "Could not detect a package manager. Install Node.js 20+ manually, then re-run."
      ;;
  esac
}

if [ "$(node_major)" -lt 20 ]; then
  install_node
fi
[ "$(node_major)" -ge 20 ] || die "Node.js 20+ is still not available. Install it manually and re-run."
ok "Node.js $(node -v) is ready."

# --- PostgreSQL ------------------------------------------------------------
start_pg_linux() {
  # Make sure a cluster exists and the service is running.
  if have systemctl; then
    # Debian/Ubuntu use 'postgresql'; RHEL family the same unit name.
    $SUDO systemctl enable --now postgresql 2>/dev/null || true
  fi
}

install_postgres() {
  head "Installing PostgreSQL"
  case "$PM" in
    brew)
      brew install postgresql@16 || brew install postgresql
      brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
      # Ensure the client is on PATH for this session.
      have psql || export PATH="$(brew --prefix)/opt/postgresql@16/bin:$PATH"
      ;;
    apt)
      $SUDO apt-get update
      $SUDO apt-get install -y postgresql postgresql-contrib
      start_pg_linux
      ;;
    dnf|yum)
      $SUDO "$PM" install -y postgresql-server postgresql-contrib
      # Initialise the data directory if it has not been done yet.
      if [ ! -s /var/lib/pgsql/data/PG_VERSION ]; then
        $SUDO postgresql-setup --initdb 2>/dev/null || $SUDO /usr/bin/postgresql-setup initdb 2>/dev/null || true
      fi
      start_pg_linux
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm postgresql
      if [ ! -s /var/lib/postgres/data/PG_VERSION ]; then
        $SUDO -u postgres initdb -D /var/lib/postgres/data 2>/dev/null || true
      fi
      start_pg_linux
      ;;
    zypper)
      $SUDO zypper install -y postgresql-server
      start_pg_linux
      ;;
    *)
      die "Could not detect a package manager. Install PostgreSQL manually, then re-run."
      ;;
  esac
}

if ! have psql; then
  install_postgres
fi
have psql || die "PostgreSQL's psql is still not on PATH. Install it manually and re-run."
ok "PostgreSQL client (psql) is ready."

# --- hand off to the cross-platform orchestrator ---------------------------
head "Handing off to the setup orchestrator"
exec node "$DIR/scripts/setup.mjs"

