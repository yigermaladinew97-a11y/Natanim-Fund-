# 🕊️ Arbaminch University Christian Students Natanim Fund Telegram Bot

A reliable, secure, production-grade Telegram bot built with **Node.js**, **Telegraf**, and **SQLite (better-sqlite3)**. Designed specifically for Arbaminch University Christian Students (Pente / Evangelical fellowship) to manage monthly Natanim fund contributions, track unpaid balances, send polite private reminders, and generate auditable financial reports.

---

## 🌟 Key Features

### 1. Robust Accounting & Data Integrity
- **Minor Currency Units**: Stored as integers in minor units (cents) to eliminate IEEE-754 floating-point rounding errors.
- **Historical Immutability**: Each monthly obligation stores its own `amount_due_cents`. Changing the standard monthly contribution does not alter past obligations.
- **Partial Payment Support**: Members can pay their monthly dues in multiple installments (Fully Paid, Partially Paid, Unpaid, Overdue).
- **Payment Methods Supported**: Cash to Treasurer, CBE Bank Transfer (CBE Mobile Banking), and CBE Birr (Commercial Bank of Ethiopia screenshots only).
- **Audited Reversals**: Payments can be reversed by an administrator with a mandatory reason. Transactions are never silently deleted; a full audit trail is preserved.
- **ACID Transactions**: Financial operations are wrapped in SQLite transactions.

### 2. Multi-Role Security & Privacy
- **Administrator**: Registers/deactivates members, configures standard contribution amount, manages treasurers, executes reversals, exports CSV reports, and reviews audit trails.
- **Treasurer**: Records verified payments, views monthly summaries and outstanding balances, and dispatches private payment reminders.
- **Regular Member**: Can privately check `/mystatus`, review their own contribution `/history`, and view `/myprofile`.
- **Zero Cross-Member Leakage**: Members can only access their own records.
- **Private By Default**: Financial commands are restricted to direct messages, preventing sensitive disclosures in group chats.

### 3. Automated & Manual Reminders
- Scheduled monthly background notifications via `node-cron` with timezone support (`Africa/Addis_Ababa`).
- Built-in 72-hour cooldown per member/month to prevent spamming.
- Graceful handling of users who have blocked the bot or not yet started it.

### 4. Financial Reporting & CSV Export
- Real-time monthly balance sheet: Active members count, fully paid, partially paid, unpaid, total expected, total verified collected, and total outstanding.
- Collections categorized by payment method.
- RFC-4180 compliant CSV export featuring formula injection protection (prevents CSV injection attacks in Excel/Sheets).

---

## 🏗️ Project Architecture

```
natanim-fund/
├── .env.example              # Sample environment configuration
├── .gitignore                # Excludes secrets, databases, and dependencies
├── Bot.js                    # Root entry point alias
├── package.json              # Project dependencies and npm scripts
├── README.md                 # Documentation and deployment guide
├── src/
│   ├── index.js              # Application bootstrapper and lifecycle
│   ├── config.js             # Validated configuration & defaults
│   ├── db/
│   │   ├── index.js          # SQLite connection and migration runner
│   │   └── schema.js         # Normalized DDL tables, indexes, constraints
│   ├── handlers/
│   │   ├── admin.js          # Admin commands (/addmember, /roles, /setamount, etc.)
│   │   ├── member.js         # Member commands (/mystatus, /history)
│   │   ├── payments.js       # Verified payment wizard (/paid)
│   │   ├── reminders.js      # Manual reminder dispatcher (/remind)
│   │   ├── reports.js        # Monthly reports & CSV export (/report, /unpaid, /export)
│   │   ├── start.js          # Onboarding, profile, and navigation (/start, /help)
│   │   └── wizard.js         # Multi-step conversational input router
│   ├── middleware/
│   │   ├── auth.js           # Role-based access control (Admin, Treasurer, Member)
│   │   ├── chatType.js       # Direct-message / private chat enforcement
│   │   └── errorHandler.js   # Safe error handling preventing info leaks
│   ├── services/
│   │   ├── accounting.js     # Payments, obligations, balances, and reversals
│   │   ├── memberService.js  # Member lifecycle management
│   │   ├── permissions.js    # Role assignment and lookups
│   │   ├── reminders.js      # Direct message dispatching and logging
│   │   ├── reporting.js      # Financial aggregations and CSV generator
│   │   └── scheduler.js      # Timezone-aware persistent cron scheduler
│   └── utils/
│       ├── csv.js            # Safe RFC-4180 CSV builder with formula escaping
│       ├── formatters.js     # Currency (ETB), date, and status formatters
│       ├── keyboards.js      # Interactive inline keyboards
│       ├── session.js        # Ephemeral wizard session store with auto-expiry
│       └── validators.js     # Input sanitization and format validators
└── tests/
    ├── accounting.test.js    # Tests for obligations, payments, and reversals
    ├── auth.test.js          # Tests for role-based security & middleware
    ├── persistence.test.js   # Verifies data persistence across restarts
    ├── privacy.test.js       # Strict verification of cross-member data isolation
    ├── reporting.test.js     # Tests financial math, summaries, and CSV output
    └── validation.test.js    # Tests input validators and money parsing
```

---

## 🚀 Setup & Local Development

### Prerequisites
- Node.js version 18.0.0 or later (tested on Node.js v26)
- npm version 9 or later

### Step 1: Clone and Install
```bash
git clone https://github.com/yigermaladinew97-a11y/Natanim-Fund-.git
cd Natanim-Fund-
npm install
```

### Step 2: Obtain Telegram Bot Token and Your Telegram ID
1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, name your bot (e.g., `Natanim Fund Bot`), and choose a unique username ending in `bot` (e.g. `natanim_fund_bot`).
3. Copy the HTTP API token provided by BotFather.
4. Message [@userinfobot](https://t.me/userinfobot) or [@raw_data_bot](https://t.me/raw_data_bot) to find your personal **numeric Telegram User ID** (e.g. `123456789`).

### Step 3: Configure Environment Variables
Create a `.env` file in the root directory:
```bash
cp .env.example .env
```
Open `.env` and fill in your values:
```env
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxyz
ADMIN_TELEGRAM_ID=123456789
DATABASE_PATH=./data/natanim_fund.db
DEFAULT_CURRENCY=ETB
DEFAULT_MONTHLY_AMOUNT_CENTS=50000
DUE_DAY_OF_MONTH=10
TIMEZONE=Africa/Addis_Ababa
REMINDER_CRON_SCHEDULE=0 9 5 * *
REMINDER_COOLDOWN_HOURS=72
NODE_ENV=development
```

### Step 4: Run Automated Tests
Before starting the bot, verify that all business logic and security policies pass:
```bash
npm test
```
*All 28 unit and integration tests should pass.*

### Step 5: Start the Bot
- **Production mode:**
  ```bash
  npm start
  ```
- **Development mode (with auto-reload):**
  ```bash
  npm run dev
  ```

---

## 📖 Command Reference

### General / Member Commands
| Command | Description |
|---|---|
| `/start` | Welcome screen, role detection, and quick action menu |
| `/register` | Self-register as a church member (submits name & phone for admin review) |
| `/mystatus` | View your monthly obligation, amount paid, balance, and due date |
| `/submitpayment` | Submit a payment receipt screenshot for admin/treasurer verification |
| `/history` | View your past 6 months obligations and transaction receipts |
| `/myprofile` | View your registered church profile details and member ID |
| `/help` | Detailed help documentation tailored to your current role |
| `/cancel` | Cancel an in-progress interactive wizard at any time |

### Treasurer & Administrator Commands
| Command | Description |
|---|---|
| `/submissions` | Browse pending payment receipt screenshots with **[ ✅ Verify & Approve ]** and **[ ❌ Reject ]** |
| `/paid` | Launch manual payment recording wizard (Member ➔ Month ➔ Amount ➔ Method ➔ Ref) |
| `/report` | Display the monthly financial summary (active members, collected, outstanding, method breakdown) |
| `/unpaid` | List active members with an outstanding balance for the current month |
| `/members` | Browse all active registered church members with pagination |
| `/remind` | Send polite private reminders to all members with unpaid balances |

### Administrator-Only Commands
| Command | Description |
|---|---|
| `/approvals` | Review pending self-registration requests with instant **[ ✅ Approve ]** and **[ ❌ Reject ]** buttons |
| `/addmember` | Register a new member manually (admin backup option): `/addmember <telegram_id> <Full Name>` |
| `/deactivate` | Deactivate a member while preserving their full financial transaction history |
| `/setamount` | Set standard contribution for future months (e.g. `/setamount 500`) |
| `/roles` | Manage treasurers: `/roles add <telegram_id>` or `/roles remove <telegram_id>` |
| `/reversepayment` | Reverse an incorrect payment: `/reversepayment <tx_id> <reason>` |
| `/export` | Download full monthly financial statement as an RFC-4180 CSV spreadsheet |
| `/audit` | View the 10 most recent administrative and financial audit log entries |

---

## 🔒 Security Best Practices

1. **Credentials**: Never commit `.env` or database files (`.db`) to Git. The provided `.gitignore` automatically excludes them.
2. **Numeric Telegram IDs**: All authorization decisions rely on immutable numeric 64-bit Telegram user IDs rather than usernames, preventing identity spoofing.
3. **Database Transactions**: Financial writes (`payments`, `payment_reversals`, `obligations`) are executed in SQLite transactions with WAL mode enabled to ensure high concurrency and consistency.
4. **Formula Injection Defense**: CSV exports prepend a quote `'` to any cell starting with `=`, `+`, `-`, or `@` to prevent execution of malicious formulas in Excel or Google Sheets.

---

## 💾 Database Backup & Maintenance

The SQLite database is stored locally in the `data/` directory (default: `data/natanim_fund.db`).

### Automated Backup Command
To take an atomic, non-blocking backup while the bot is running:
```powershell
# Windows PowerShell
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
sqlite3 data/natanim_fund.db ".backup backups/natanim_fund_$timestamp.db"
```
```bash
# Linux / macOS
timestamp=$(date +%Y%m%d_%H%M%S)
sqlite3 data/natanim_fund.db ".backup backups/natanim_fund_${timestamp}.db"
```

### Restoration
To restore from a backup:
1. Stop the bot (`pm2 stop natanim-fund` or `Ctrl+C`).
2. Replace `data/natanim_fund.db` with your verified backup copy.
3. Restart the bot.

---

## 🌐 Production Deployment Guide (PM2 / Linux VPS)

To keep the bot running 24/7 on a cloud server (e.g. Ubuntu VPS on DigitalOcean, AWS EC2, or Hetzner):

1. **Install PM2 globally:**
   ```bash
   npm install -g pm2
   ```
2. **Start the bot via PM2:**
   ```bash
   pm2 start src/index.js --name "natanim-fund"
   ```
3. **Save PM2 process list:**
   ```bash
   pm2 save
   pm2 startup
   ```
4. **Inspect logs:**
   ```bash
   pm2 logs natanim-fund
   ```

---

## 📄 License
ISC License. Built with devotion for Natanim Fund.

