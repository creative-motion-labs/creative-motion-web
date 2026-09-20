# RASQ Development Workflow
## Team Engineering Handbook

**Version:** 2.0
**Last Updated:** August 6, 2026
**Last Verified Against Repository Workflow:** August 6, 2026
**Repository:** creative-motion-web
**Team:** Creative Motion Lab

**Document Authority:**
This document is the official development workflow reference unless superseded by GitHub repository protection rules or documented engineering decisions approved by the project lead.

---

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [Branch Protection Rules](#branch-protection-rules)
3. [Daily Developer Workflow](#daily-developer-workflow)
4. [Pull Request and Promotion Gates](#pull-request-and-promotion-gates)
5. [Validation Matrix](#validation-matrix)
6. [Git Rules](#git-rules)
7. [Team Responsibilities](#team-responsibilities)
8. [Code Review Checklist](#code-review-checklist)
9. [Emergency Procedures](#emergency-procedures)
10. [Best Practices](#best-practices)
11. [Document Maintenance](#document-maintenance)

---

## Repository Structure

### Branch Hierarchy

**Official Promotion Flow:**

```
feature/* (local development)
    ↓
   [Pull Request + Review]
    ↓
  test (integration and QA)
    ↓
   [Pull Request + Review]
    ↓
  dev (development/staging)
    ↓
   [Pull Request + Review]
    ↓
  main (production)
```

### Branch Purposes

#### `main` - Production Branch
- **Purpose:** Production-ready code only
- **Team Policy:** Must be treated as protected - direct pushes and force pushes prohibited
- **GitHub Protection:** Should be configured with required PR reviews and status checks (verify in repository settings)
- **Deployment:** Production environment (deployment process pending confirmation)
- **Stability:** Must always be deployable
- **Updates:** Only through reviewed pull requests from `dev`
- **Direct Push:** ❌ **PROHIBITED**
- **Force Push:** ❌ **PROHIBITED**

**Environment Variables:**
- `NODE_ENV=production`
- Backend URL: Pending confirmation
- Database: Production database (Supabase or approved provider)

#### `dev` - Development/Staging Branch
- **Purpose:** Development and staging integration point
- **Team Policy:** Must be treated as protected - direct pushes and force pushes prohibited
- **GitHub Protection:** Should be configured with required PR reviews and status checks (verify in repository settings)
- **Deployment:** Development/staging environment (pending confirmation)
- **Testing:** Integration tests and staging validation
- **Updates:** Only through reviewed pull requests from `test`
- **Direct Push:** ❌ **PROHIBITED**

**Environment Variables:**
- `NODE_ENV=development` or `NODE_ENV=staging`
- Backend URL: Approved development or staging endpoint
- Database: Development or staging database

#### `test` - Integration and QA Branch
- **Purpose:** Team integration and quality assurance
- **Team Policy:** Should be treated as protected - direct pushes not recommended
- **GitHub Protection:** Protection should be enabled (verify in repository settings)
- **Testing:** Full regression and integration testing
- **Updates:** Only through reviewed pull requests from `feature/*`
- **Direct Push:** ❌ **NOT RECOMMENDED** (use pull requests)

**Environment Variables:**
- `NODE_ENV=test` or `NODE_ENV=development`
- Backend URL: Approved test endpoint or localhost
- Database: Test/QA database (non-production)

#### `feature/*` - Feature Branches
- **Naming Convention:** `feature/short-descriptive-name`
- **Purpose:** Isolated feature development
- **Lifespan:** Short (1-5 days recommended)
- **Base Branch:** Created from current `test` branch
- **Merge Target:** Open pull request to `test`
- **Deletion:** Must be deleted after merge
- **Testing:** Developer runs focused tests before opening PR

**Examples:**
- `feature/patient-dashboard-improvements`
- `feature/gait-analysis-optimization`
- `feature/arabic-translation-updates`

---

## Branch Protection Rules

### Team Policy

**The following branches MUST be treated as protected:**

- `main` - Requires strictest protection
- `dev` - Requires strict protection
- `test` - Protection strongly recommended

**Team Policy Requirements:**
- Direct pushes to protected branches are prohibited
- Force pushes to protected branches are prohibited
- Changes must be promoted through pull requests
- Independent review is required where applicable
- Branch deletion of protected branches is prohibited

### Recommended GitHub Configuration

**The following GitHub repository settings are recommended for enforcement. These must be verified and configured in GitHub repository settings.**

**For `main` and `dev` (Recommended Settings):**
- Require pull request before merging
- Require at least 1 approval before merging
- Dismiss stale approvals when new commits are pushed
- Require status checks to pass before merging (when CI/CD configured)
- Require branches to be up to date before merging
- Require conversation resolution before merging
- Do not allow bypassing the above settings
- Restrict who can push to matching branches
- Do not allow force pushes
- Do not allow deletions

**For `test` (Recommended Settings):**
- Require pull request before merging (recommended)
- Require status checks when available
- Do not allow force pushes

**Verification Status:**
- Team policy is documented above and applies immediately
- GitHub repository protection rules should be checked in Settings → Branches to confirm actual enforcement
- Where automated enforcement has not been verified, manual discipline and code review must ensure policy compliance
- This document describes policy and recommended configuration; actual GitHub settings take precedence for automated enforcement

### Emergency Exceptions

In exceptional circumstances (production-critical hotfix, security vulnerability):

1. Emergency bypass requires **documented approval** from project lead
2. Emergency action must be followed by:
   - Immediate incident report
   - Retrospective review
   - Corrective pull request documenting the change
   - Backporting to all affected branches

3. Emergency changes still require:
   - Code review (can be post-merge for critical issues)
   - Testing (minimum smoke tests)
   - Documentation update

---

## Daily Developer Workflow

### Step-by-Step Guide

#### 1. Start Your Day

```bash
# Navigate to repository
cd creative-motion-web

# Check current branch
git branch

# Switch to test if not already there
git checkout test

# Pull latest changes from remote
git pull origin test
```

**Why:** Ensures you start with the latest integrated code and avoid merge conflicts later.

---

#### 2. Create a Feature Branch

```bash
# Create and switch to feature branch
git checkout -b feature/your-feature-name

# Verify you're on the correct branch
git branch
```

**Naming Rules:**
- Use lowercase with hyphens
- Be descriptive but concise
- Start with `feature/`
- Examples:
  - ✅ `feature/add-patient-notes`
  - ✅ `feature/fix-assessment-validation`
  - ❌ `my-branch` (not descriptive)
  - ❌ `feature/fix` (too vague)

---

#### 3. Develop Your Feature

```bash
# Make your changes
# Edit files in your IDE

# Check what changed
git status

# Review your changes
git diff

# Stage specific files
git add path/to/changed/file.ts

# Or stage all changes (use carefully)
git add .

# Commit with descriptive message
git commit -m "feat: add patient notes to assessment summary"
```

**Commit Message Format:**
```
<type>: <description>

[optional body]

[optional footer]
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, no logic change)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

---

#### 4. Keep Your Branch Updated

```bash
# Fetch latest changes from remote
git fetch origin

# Switch to test and pull
git checkout test
git pull origin test

# Switch back to your feature branch
git checkout feature/your-feature-name

# Merge test into your feature branch
git merge test

# Or rebase (advanced - ask technical lead first)
git rebase test
```

**When to update:**
- Daily, before starting work
- Before opening a pull request
- When you know test has important updates

---

#### 5. Push Your Feature Branch

```bash
# Push to remote for the first time
git push -u origin feature/your-feature-name

# Subsequent pushes
git push
```

**Push frequency:**
- At least once daily (backup)
- After significant progress
- Before asking for review
- Before leaving for the day

---

#### 6. Open a Pull Request

**On GitHub:**

1. Navigate to: `https://github.com/aishaalkldi/creative-motion-web`
2. Click "Pull requests" tab
3. Click "New pull request"
4. Set **base:** `test` and **compare:** `feature/your-feature-name`
5. Fill out the PR template:

```markdown
## Summary
Brief description of what this PR does.

## Changes
- Added patient notes field to assessment summary
- Updated UI to display notes in clinician view
- Added validation for notes field

## Type of Change
- [ ] Bug fix
- [x] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [x] Unit tests pass
- [x] Manual testing completed
- [ ] Tested on staging
- [x] No console errors

## Checklist
- [x] Code follows project style guidelines
- [x] Self-review completed
- [x] Comments added for complex logic
- [x] Documentation updated
- [x] No new warnings
- [ ] Deployment notes added (if needed)

## Screenshots (if applicable)
[Attach screenshots of UI changes]

## Related Issues
Closes #123
```

6. Request reviewers (minimum 1, recommended 2)
7. Add labels (feature, bug, documentation, etc.)
8. Submit the PR

---

#### 7. Code Review Process

**As Author:**
1. Respond to review comments within 24 hours
2. Make requested changes in new commits
3. Push updates to the same branch
4. Re-request review after changes
5. Resolve conversations when addressed

**Review Timeline:**
- Small PR (<100 lines): 2-4 hours
- Medium PR (100-300 lines): 4-8 hours
- Large PR (>300 lines): 1-2 days

---

#### 8. Merge to Test

**After approval:**

1. Ensure all CI checks pass ✅
2. Resolve any merge conflicts
3. Squash and merge (preferred) or merge commit
4. Delete the feature branch
5. Pull latest test locally

```bash
# After merge, clean up
git checkout test
git pull origin test
git branch -d feature/your-feature-name
```

---

## Pull Request and Promotion Gates

### A. Feature → Test (Individual Features)

**Trigger:** When scoped implementation is complete
**Performed By:** Developer
**Process:**

**Before Opening PR:**
```bash
# Ensure feature branch is up to date
git checkout feature/your-feature-name
git fetch origin
git merge origin/test

# Run focused tests
npm test -- <relevant-test-files>

# Run build check
npm run build

# Review changes
git diff origin/test...HEAD
git status
```

**Pull Request Requirements:**
- ✅ Scoped implementation completed
- ✅ Developer self-review completed
- ✅ Focused tests pass locally
- ✅ No unrelated changes included
- ✅ No merge conflicts with `test`
- ✅ Commit messages are clear
- ✅ PR description explains what and why

**Review and Approval:**
- Minimum 1 reviewer approval required
- Reviewer verifies:
  - Code quality and correctness
  - Tests cover changes
  - No security issues
  - Clinical safety (if applicable)
  - Documentation updated

---

### B. Test → Dev (Integration Promotion)

**Trigger:** When integration testing is successful
**Performed By:** Technical lead or authorized reviewer
**Process:**

**Before Opening PR:**
```bash
# Verify test branch is stable
git checkout test
git pull origin test

# Run full regression
npm test

# Run TypeScript, ESLint, and build checks (when applicable)
npx tsc --noEmit
npx eslint .
npm run build
```

**Pull Request Requirements:**
1. Open pull request from `test` to `dev` on GitHub
2. PR title: `chore: promote test to dev - [brief description]`
3. PR description includes:
   - List of features included
   - Integration test results
   - Any environment configuration changes

**Review and Approval:**
- Technical lead or authorized reviewer approval required
- Verify:
  - All tests pass
  - No regressions introduced
  - Environment configuration confirmed
  - Relevant stakeholders notified

**After Merge:**
```bash
git checkout dev
git pull origin dev
```

---

### C. Dev → Main (Release Promotion)

**Trigger:** When release scope is confirmed and staging validation complete
**Performed By:** Project lead
**Process:**

**Before Opening PR:**
```bash
# Verify dev branch is release-ready
git checkout dev
git pull origin dev

# Run final checks
npm test
npm run build

# Verify production configuration
```

**Pull Request Requirements:**
1. Open pull request from `dev` to `main` on GitHub
2. PR title: `release: version [X.Y.Z] - [release name]`
3. PR description includes:
   - Release scope and features
   - Breaking changes (if any)
   - Migration steps (if any)
   - Deployment checklist
   - Rollback plan

**Review and Approval:**
- Project lead approval **required**
- Final verification:
  - Production configuration verified
  - Deployment plan confirmed
  - Rollback procedure ready
  - Stakeholders notified

**After Merge:**
```bash
# Pull the merged main branch
git checkout main
git pull origin main

# Create release tag ONLY after successful merge
git tag -a v1.2.3 -m "Release version 1.2.3 - [Release Name]"
git push origin v1.2.3

# Complete deployment
# Run health checks
# Monitor production
```

**Post-Release:**
- Monitor production health for 24-48 hours
- Document any issues encountered
- Update release notes
- Communicate to team

---

## Validation Matrix

### Required Checks by Change Type

| Change Type | Required Validations | Notes |
|-------------|---------------------|-------|
| **Documentation** | • Markdown review<br>• Link verification<br>• Branch name accuracy<br>• No code tests required (unless examples changed) | Code examples in docs must be tested if modified |
| **Frontend** | • Focused unit tests<br>• ESLint<br>• TypeScript check<br>• Production build<br>• Relevant manual UI checks<br>• No console errors | Full regression for architectural changes |
| **Backend/API** | • Focused tests<br>• API behavior validation<br>• Database-readiness validation<br>• Authentication checks (if affected)<br>• Authorization checks (if affected) | Integration tests when endpoints change |
| **Database** | • Migration review<br>• Staging validation required<br>• Backup plan documented<br>• Rollback plan documented<br>• ❌ No direct production change without approval | Never apply migrations directly to production |
| **Clinical/CV** | • Regression tests<br>• Tracking-quality checks<br>• Real-camera/manual validation (when required)<br>• Clinical review (see below)<br>• Clear separation of measured vs. interpreted values | Compensation detection, ROM measurements, safety thresholds require validation |

### Clinical and Patient-Safety Review

**Changes affecting the following require clinical or project-lead review in addition to technical review:**

- Clinical wording or recommendations
- Measured values (angles, distances, times)
- Interpretation of measurements
- Exercise difficulty or progression
- Compensation detection or handling
- Patient identity or session results
- Safety thresholds or alerts
- Assessment scoring or classification

**Review Process:**
1. Technical review for code correctness
2. Clinical/project-lead review for appropriateness
3. Documentation that no clinical validation claims are made without evidence
4. Clear separation maintained between:
   - Measured sensor/CV data (factual)
   - AI interpretation or clinical suggestions (advisory, editable)

**Software output must not be described as clinically validated unless:**
- Clinical validation study has been completed
- Results have been documented
- Approval from appropriate authority exists

---

## Git Rules

### Critical Rules (Never Violate)

#### ❌ Rule 1: Never Commit Directly to Protected Branches
**Violation Impact:** Production breakage, deployment failures, bypass of review process
**Team Policy:** Direct commits to `main`, `dev`, and `test` are prohibited. Changes must use pull requests.
**GitHub Protection:** Repository settings should be verified to enforce this policy automatically.
**Exception:** None (emergency changes still require PR, can be expedited)

```bash
# ❌ NEVER DO THIS
git checkout main  # or dev, or test
git commit -m "quick fix"
git push

# ✅ ALWAYS DO THIS
git checkout -b feature/quick-fix
git commit -m "fix: resolve issue"
git push -u origin feature/quick-fix
# Then open a PR to test
```

---

#### ❌ Rule 2: Never Force Push
**Violation Impact:** Lost commits, team work destroyed
**Enforcement:** Manual discipline
**Exception:** Only on personal feature branches with team lead approval

```bash
# ❌ NEVER DO THIS
git push --force
git push -f

# ✅ IF YOU MUST (rare)
git push --force-with-lease  # Only on feature branches, after team confirmation
```

---

#### ✅ Rule 3: Pull Before Starting Work
**Purpose:** Avoid merge conflicts and lost work
**Frequency:** Every time you start coding

```bash
# ✅ ALWAYS DO THIS
git checkout test
git pull origin test
git checkout feature/your-branch
git merge test
```

---

#### ✅ Rule 4: Keep Feature Branches Small
**Guidelines:**
- Lifespan: 1-5 days
- Changes: 100-300 lines recommended
- Scope: Single feature or bug fix
- Commits: 3-10 commits per branch

**Why:**
- Easier to review
- Faster to merge
- Lower conflict risk
- Easier to revert if needed

---

#### ✅ Rule 5: Delete Merged Feature Branches
**Timing:** Immediately after merge
**Location:** Both local and remote

```bash
# After PR is merged
git checkout test
git pull origin test
git branch -d feature/merged-feature

# If branch not deleted on GitHub
git push origin --delete feature/merged-feature
```

---

#### ✅ Rule 6: Resolve Conflicts Before Opening PR
**Process:**
1. Pull latest test
2. Merge test into feature branch
3. Resolve conflicts locally
4. Test thoroughly
5. Push and open PR

```bash
git checkout feature/your-branch
git fetch origin
git merge origin/test
# Resolve conflicts in IDE
git add .
git commit -m "merge: resolve conflicts with test"
git push
```

---

#### ✅ Rule 7: Change Isolation
**Principle:** One logical task per feature branch

**Guidelines:**
- Do not mix documentation, code, infrastructure, clinical wording, and database changes unless inseparable
- Do not include unrelated formatting changes
- Review `git diff` and `git status` before every commit and push
- Untracked or unrelated local files must not be staged accidentally

**Before Every Commit:**
```bash
# Review what's about to be committed
git status
git diff

# Review staged changes specifically
git diff --staged

# Unstage unrelated files if needed
git reset HEAD <unrelated-file>
```

**Why:**
- Easier code review
- Cleaner git history
- Safer to revert if needed
- Reduces merge conflicts

---

### Additional Rules

#### Environment Files
- ❌ Never commit `.env`, `.env.local`, or `.env.production`
- ❌ Never expose API keys or secrets
- ✅ Use `.env.example` for documentation
- ✅ Encrypt secrets if they must be in repository

#### Dependencies
- ✅ Explain why before adding new dependencies
- ✅ Check bundle size impact
- ✅ Verify license compatibility
- ❌ Never install unverified packages

#### Clinical Safety
- ❌ Never invent clinical findings
- ✅ Keep measured values separate from AI interpretation
- ✅ Use cautious wording: "may indicate" not "patient has"
- ✅ All AI content must remain editable

#### Working Features
- ❌ Never delete working features without approval
- ❌ Never modify unrelated files
- ✅ Preserve existing routes and user flows
- ✅ Maintain backward compatibility

---

## Team Responsibilities

### Project Lead
**Git Privileges:** Full access, can approve and merge to main

**Responsibilities:**
- Approve releases to production
- Review and approve release PRs (`dev` → `main`)
- Create version tags after successful merge
- Sign off on deployment
- Resolve team conflicts
- Architecture decisions
- Sprint planning

**Daily Tasks:**
- Review critical PRs
- Monitor production health
- Approve hotfixes
- Update stakeholders

**When Project Lead Unavailable:**
- Another authorized senior leader may approve releases
- Emergency releases require documented approval and retrospective review
- Same technical gates must be met

---

### Technical Lead
**Git Privileges:** Can review and approve PRs to all branches

**Responsibilities:**
- Code quality oversight
- Review and approve promotion PRs (`test` → `dev`)
- Technical architecture decisions
- Set coding standards
- Mentor developers
- Review complex PRs

**Daily Tasks:**
- Review PRs to test
- Monitor CI/CD pipeline
- Code review quality checks
- Technical planning
- Resolve technical blockers

**When Technical Lead Unavailable:**
- Another authorized senior developer may review PRs
- Complex architectural decisions should wait or be escalated to project lead
- Same code quality standards must be maintained

---

### Senior Developers
**Git Privileges:** Can create branches, open PRs, review code

**Responsibilities:**
- Implement features
- Review peer code
- Mentor junior developers
- Design technical solutions
- Write documentation

**Daily Tasks:**
- Work on feature branches
- Review 2-3 PRs daily
- Participate in code reviews
- Update documentation
- Help unblock team members

---

### Developers
**Git Privileges:** Can create feature branches, open PRs

**Responsibilities:**
- Implement assigned features
- Write tests
- Fix bugs
- Update documentation
- Participate in reviews

**Daily Tasks:**
- Work on feature branches
- Write clean, tested code
- Respond to review comments
- Ask questions early
- Keep team updated

---

### Code Reviewers
**Anyone can review, but approval requires:**
- Senior Developer (1 approval minimum for feature PRs)
- Technical Lead (for complex changes or promotion PRs)
- Project Lead (for release PRs to main)

**Self-Approval:**
- Authors should not self-approve when independent review is required
- When normal reviewer is unavailable:
  - Another authorized reviewer may review
  - Same technical gates must be met
  - Document who reviewed and why normal process was adjusted

**Responsibilities:**
- Review code quality
- Verify tests pass
- Check for security issues
- Ensure documentation updated
- Verify no breaking changes
- Clinical review when applicable

**Review Turnaround:**
- Small PR (<100 lines): 2-4 hours
- Medium PR (100-300 lines): Same day
- Large PR (>300 lines): Next day
- Promotion/Release PRs: Within scheduled promotion window


---

## Code Review Checklist

### For Reviewers

#### ✅ Code Quality
- [ ] Code is readable and well-structured
- [ ] No unnecessary complexity
- [ ] Follows project style guidelines (TypeScript, React conventions)
- [ ] No commented-out code (unless with explanation)
- [ ] No console.log statements in production code
- [ ] Proper error handling implemented

#### ✅ Functionality
- [ ] Code does what the PR description says
- [ ] Edge cases considered
- [ ] No breaking changes (or properly documented)
- [ ] Business logic is correct
- [ ] UI matches design (if applicable)

#### ✅ Testing
- [ ] Unit tests written for new functions
- [ ] Tests cover edge cases
- [ ] All tests pass (CI green ✅)
- [ ] Manual testing completed
- [ ] No regression in existing features

#### ✅ Security
- [ ] No exposed secrets or API keys
- [ ] Input validation implemented
- [ ] SQL injection prevention (if applicable)
- [ ] XSS prevention (if applicable)
- [ ] Authentication/authorization correct

#### ✅ Performance
- [ ] No obvious performance bottlenecks
- [ ] Database queries optimized
- [ ] Large lists virtualized
- [ ] Images optimized
- [ ] No memory leaks

#### ✅ Clinical Safety (RASQ Specific)
- [ ] No invented clinical findings
- [ ] Cautious wording used ("may indicate", not "patient has")
- [ ] Measured values separate from AI interpretation
- [ ] AI-generated content is editable
- [ ] Patient safety prioritized over visual effects

#### ✅ Documentation
- [ ] README updated (if needed)
- [ ] Code comments for complex logic
- [ ] API documentation updated
- [ ] Migration notes added (if schema changed)
- [ ] Deployment notes added (if infra changed)

#### ✅ Git Hygiene
- [ ] Branch is up-to-date with test
- [ ] No merge conflicts
- [ ] Commit messages are clear
- [ ] No unnecessary commits
- [ ] Feature branch will be deleted after merge

---

### Review Comments Guidelines

#### Effective Comments

**❌ Bad:**
```
This is wrong.
```

**✅ Good:**
```
The null check is missing here. If `patient` is undefined, this will throw an error.
Suggestion:
if (!patient) return null;
```

---

**❌ Bad:**
```
Don't do this.
```

**✅ Good:**
```
Using `var` is discouraged in modern TypeScript. Consider using `const` or `let`.
See: https://typescript-lang.org/docs/handbook/variable-declarations.html
```

---

#### Comment Labels

Use these prefixes for clarity:

- **🔴 Blocking:** Must be fixed before merge
- **🟡 Suggestion:** Nice to have, but optional
- **🟢 Praise:** Positive feedback
- **💡 Question:** Asking for clarification
- **📚 Learn:** Educational comment

**Examples:**
```
🔴 Blocking: This will cause a runtime error if patient is null.
🟡 Suggestion: Consider extracting this into a utility function for reusability.
🟢 Praise: Excellent error handling here!
💡 Question: Why did you choose this approach over the previous implementation?
📚 Learn: For future reference, React.memo can help optimize this component.
```

---

## Emergency Procedures

### Scenario 1: Build Fails on Test

**Symptoms:**
- CI/CD pipeline fails
- Tests don't pass
- TypeScript errors

**Immediate Actions:**
1. Check the build log for errors
2. Identify the failing commit or PR
3. Notify the commit author
4. Author has 30 minutes to fix or PR will be reverted

**Resolution Process:**
```bash
# If quick fix possible - open new PR
git checkout -b fix/build-failure
# Fix the issue
git add .
git commit -m "fix: resolve build failure"
git push -u origin fix/build-failure
# Open PR to test

# If fix takes longer - revert the problematic PR via GitHub
# Use GitHub's "Revert" button on the merged PR
# This creates a new PR that undoes the changes
# Then fix properly on a new feature branch
```

**Prevention:**
- Always run `npm run build` before pushing
- Run tests locally: `npm test`
- Enable pre-commit hooks

---

### Scenario 2: Merge Conflict on PR

**Symptoms:**
- GitHub shows "This branch has conflicts"
- Cannot merge PR

**Resolution Process:**
```bash
# On your feature branch
git checkout feature/your-branch
git fetch origin
git merge origin/test

# Resolve conflicts in your IDE
# Look for <<<<<<, ======, >>>>>>

# After resolving
git add .
git commit -m "merge: resolve conflicts with test"
git push

# Verify tests still pass
npm test
npm run build
```

**Prevention:**
- Pull from test daily
- Keep feature branches short-lived
- Communicate with team about overlapping work

---

### Scenario 3: Production Deployment Fails

**Severity:** 🔴 Critical
**Response Time:** Immediate

**Immediate Actions:**
1. **Alert team:** "Production deployment failed - investigating"
2. **Check deployment logs** for error details
3. **Rollback immediately** if users are affected

**Rollback Procedure (Preferred Method):**

**Option 1: GitHub Revert PR (Preferred)**
1. On GitHub, navigate to the merged release PR
2. Click "Revert" button
3. This creates a new PR that undoes the release
4. Review and merge the revert PR immediately
5. Monitor deployment of reverted state

**Option 2: Platform Redeployment (If Supported)**
1. Use deployment platform (Vercel/hosting provider) to redeploy previous successful release
2. Select the previous tag/deployment from platform dashboard
3. Monitor redeployment health

**Emergency Revert (If Above Not Available):**
```bash
# Create revert PR
git checkout main
git pull origin main
git revert -m 1 HEAD
git push -u origin revert-release
# Open PR, get emergency approval, merge
```

**DO NOT:**
- ❌ Check out old tag and push directly to main
- ❌ Force push to main
- ❌ Skip PR process even in emergency

**Post-Incident:**
1. Write incident report
2. Identify root cause
3. Create prevention plan
4. Update deployment checklist
5. Backport any emergency fixes to dev and test

---

### Scenario 4: Hotfix Required

**Definition:** Critical bug in production that requires immediate fix

**Hotfix Process:**

```bash
# Create hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-auth-bug

# Fix the bug
# Write tests
git add .
git commit -m "hotfix: resolve authentication bypass vulnerability"

# Push and open URGENT PR
git push -u origin hotfix/critical-auth-bug
```

**Pull Request:**
1. Open PR from `hotfix/critical-auth-bug` to `main`
2. Mark as URGENT/CRITICAL
3. Request immediate review from Technical Lead + Project Lead
4. PR must still meet security and correctness standards (can skip full regression if justified)

**After Hotfix Merged to Main:**

Backport to dev and test via pull requests:

```bash
# Option 1: Cherry-pick via PR (Preferred)
git checkout dev
git pull origin dev
git checkout -b backport/hotfix-to-dev
git cherry-pick <hotfix-commit-sha>
git push -u origin backport/hotfix-to-dev
# Open PR to dev

git checkout test
git pull origin test
git checkout -b backport/hotfix-to-test
git cherry-pick <hotfix-commit-sha>
git push -u origin backport/hotfix-to-test
# Open PR to test

# Option 2: If cherry-pick conflicts, recreate fix on each branch
```

**Hotfix Criteria:**
- Security vulnerability
- Data loss risk
- Complete feature breakage
- Legal/compliance issue

**Not Hotfix (Use Normal PR Process):**
- UI polish
- Performance optimization
- Minor bugs with workarounds

**Post-Hotfix:**
- Document incident
- Retrospective review
- Update monitoring/alerts to catch similar issues

---

### Scenario 5: Lost Work / Deleted Branch

**Symptoms:**
- Accidentally deleted branch
- Accidentally reset commits
- Lost local changes

**Recovery:**

```bash
# Find lost commits
git reflog

# Restore from reflog
git checkout -b recovered-branch <commit-sha>

# Or restore deleted branch
git checkout -b feature/restored origin/feature/deleted
```

**Prevention:**
- Push frequently (at least daily)
- Never force push
- Use `git stash` before risky operations

---

## Best Practices

### Documentation

#### README Updates
**When to update:**
- New environment variables added
- Setup process changes
- New dependencies required
- Architecture changes

**Keep current:**
- Installation instructions
- Environment setup
- Running the app locally
- Running tests

---

#### Code Comments

**When to add comments:**
```typescript
// ✅ Good: Explain WHY, not WHAT
// Using exponential backoff to avoid overwhelming the API during high traffic
const retryDelay = Math.pow(2, attempt) * 1000;

// ❌ Bad: Stating the obvious
// Multiply by 1000
const retryDelay = attempt * 1000;
```

**Complex Logic:**
```typescript
// ✅ Good: Explain complex business logic
/**
 * Calculate rehabilitation readiness score based on multiple factors:
 * 1. Assessment completion rate (40% weight)
 * 2. Exercise adherence (30% weight)
 * 3. Progress velocity (30% weight)
 *
 * Returns score 0-100, where >70 indicates ready for next phase.
 */
function calculateReadinessScore(patient: Patient): number {
  // Implementation
}
```

---

#### API Documentation

**Update when:**
- New endpoints added
- Request/response format changes
- Authentication requirements change

**Document:**
- Endpoint URL
- HTTP method
- Request body schema
- Response schema
- Error codes
- Example requests

---

### Commit Practices

#### Atomic Commits
**One commit = one logical change**

```bash
# ✅ Good: Separate concerns
git commit -m "feat: add patient notes field to database schema"
git commit -m "feat: add patient notes UI component"
git commit -m "feat: wire patient notes to API"

# ❌ Bad: Everything at once
git commit -m "add patient notes feature with UI, API, and database"
```

---

#### Commit Message Quality

**Format:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Examples:**

```
feat(assessment): add gait analysis report generation

Implement PDF report generation for gait assessments including:
- Movement metrics visualization
- Clinical interpretation summary
- Comparison with previous assessments
- Recommendations for therapy

Closes #245
```

```
fix(auth): prevent session timeout during long assessments

Users were being logged out mid-assessment when assessments exceeded
30 minutes. Now refresh token before expiry if user is active.

Fixes #312
```

---

### Testing Practices

#### Test Coverage Expectations
- **Critical paths:** 100% coverage
- **Business logic:** 90%+ coverage
- **UI components:** 70%+ coverage
- **Utilities:** 100% coverage

#### Testing Pyramid
```
        ┌─────────────┐
        │  E2E Tests  │  ← Few, slow, expensive
        ├─────────────┤
        │Integration  │  ← Medium number
        ├─────────────┤
        │ Unit Tests  │  ← Many, fast, cheap
        └─────────────┘
```

#### What to Test
✅ **Always test:**
- User authentication and authorization
- Data validation
- Error handling
- Critical business logic
- API integrations
- Clinical calculations

❌ **Don't waste time testing:**
- Third-party libraries
- Simple getters/setters
- Framework internals

---

### Communication

#### Daily Standups
**Share:**
1. What I completed yesterday
2. What I'm working on today
3. Any blockers

**Keep brief:** 2 minutes per person

---

#### Pull Request Communication

**When opening PR:**
- @ mention reviewers
- Link to related issue
- Explain non-obvious decisions
- Add screenshots for UI changes

**When reviewing:**
- Review within turnaround time
- Be constructive, not critical
- Ask questions to understand
- Approve when ready

**When addressing comments:**
- Respond to each comment
- Push changes
- Re-request review
- Resolve conversations

---

#### Slack/Teams Channels

**#dev-team:** General development discussion
**#code-review:** PR review requests
**#deployments:** Deployment notifications
**#incidents:** Production issues
**#help:** Questions and support

---

### Performance Optimization

#### Before Optimizing
1. **Measure first:** Use profiler
2. **Identify bottleneck:** Don't guess
3. **Set target:** Define success metric
4. **Optimize:** Make targeted changes
5. **Measure again:** Verify improvement

#### Common Optimizations
- Memoize expensive calculations (`useMemo`, `React.memo`)
- Virtualize long lists
- Lazy load images
- Code split large components
- Debounce user input
- Cache API responses

---

### Security Practices

#### Never Commit
- ❌ API keys
- ❌ Passwords
- ❌ Private keys
- ❌ Environment files
- ❌ User data

#### Always Validate
- ✅ User input
- ✅ API responses
- ✅ File uploads
- ✅ Query parameters

#### Use
- ✅ HTTPS everywhere
- ✅ Content Security Policy
- ✅ Authentication tokens
- ✅ Rate limiting

---

## Quick Reference

### Common Commands

```bash
# Start new feature
git checkout test
git pull origin test
git checkout -b feature/my-feature

# Save progress
git add .
git commit -m "feat: description"
git push -u origin feature/my-feature

# Update from test
git checkout test
git pull origin test
git checkout feature/my-feature
git merge test

# Clean up after merge
git checkout test
git pull origin test
git branch -d feature/my-feature
```

---

### Emergency Contacts

**Production Issues:**
- Project Lead: [Contact info needed]
- Technical Lead: [Contact info needed]
- On-call rotation: [Schedule needed]

**After Hours:**
- Emergency hotline: [Number needed]
- Slack channel: #incidents

---

## Document Maintenance

**Owner:** Engineering / Project Lead

**This document should be reviewed and updated:**
- After any branch flow change
- After any deployment or environment change
- After any approval process change
- When team structure changes
- When new tools or workflows are adopted
- Monthly verification recommended

**Verification Requirements:**
- Compare documented workflow against actual GitHub branch protection settings
- Verify environment URLs and deployment processes are current
- Check that role-based procedures match actual team structure
- Confirm CLI commands still work with current repository setup

**Infrastructure and Environment Claims:**
- URLs, deployment processes, and environment details marked "Pending confirmation" should be updated only after verification
- Do not document infrastructure or approvals that haven't been established
- Time-sensitive details should be verified against current state before relying on them
- When in doubt, mark as "Pending confirmation" rather than assume

**Historical Changes:**
- Major workflow changes should be documented in decision logs or archived documentation
- Active instructions should reflect current official workflow only
- Deprecated workflows should be removed, not left as alternatives

**Single Source of Truth:**
- This document is the official workflow reference
- Superseded only by:
  - GitHub repository protection rules (actual settings take precedence)
  - Documented engineering decisions approved by project lead
  - Emergency procedures established during critical incidents (must be documented)

**Current Version:** 2.0
**Last Updated:** August 6, 2026
**Last Verified Against Repository Workflow:** August 6, 2026
**Next Review:** September 6, 2026 (or sooner if workflow changes)

---

## Appendix

### Useful Links

- **Repository:** https://github.com/aishaalkldi/creative-motion-web
- **Project Board:** Pending confirmation
- **CI/CD Dashboard:** Pending confirmation
- **Production:** Pending confirmation (verify current deployment URL)
- **Staging:** Pending confirmation
- **API Docs:** Pending confirmation

**Note:** URLs marked "Pending confirmation" should be verified and updated when established.

### Related Documents

- `CLAUDE.md` - Project context and architecture
- `AGENTS.md` - Agent working agreement
- `.cursor/rules/00-project-safety.mdc` - Repository safety rules
- `.cursor/rules/10-clinical-safety.mdc` - Clinical safety guidelines
- `docs/architecture/environment-separation.md` - Environment configuration

---

**Remember:** When in doubt, ask. Better to ask a "silly" question than to break production. 🚀
