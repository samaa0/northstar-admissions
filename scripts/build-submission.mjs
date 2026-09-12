import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const submission = path.join(root, 'submission');
const zipPath = path.join(root, 'ISOM5260_Submission_CHUI_Hung_Sum_21241047_FINAL.zip');
const shouldReplace = process.argv.includes('--replace');

if (fs.existsSync(submission) && !shouldReplace) {
  throw new Error('submission/ already exists; pass --replace after preserving any prior package');
}
if (shouldReplace && fs.existsSync(submission)) fs.rmSync(submission, { recursive: true, force: true });

const copyTree = (source, target, filter = () => true) => {
  fs.cpSync(source, target, { recursive: true, force: true, filter });
};
const excluded = (source) => {
  const relative = path.relative(root, source);
  return !relative.includes('node_modules')
    && !relative.includes('dist')
    && !relative.includes('tmp')
    && !relative.includes('.git')
    && !relative.endsWith('.icloud-placeholder')
    && !relative.endsWith('.DS_Store')
    && !relative.endsWith('.db-wal')
    && !relative.endsWith('.db-shm')
    && !relative.endsWith('.legacy-2026-09-12T15-46-40-824Z')
    && !relative.endsWith('.env.local');
};

fs.mkdirSync(submission, { recursive: true });
fs.mkdirSync(path.join(submission, '01_Documentation'), { recursive: true });
fs.mkdirSync(path.join(submission, '02_Working_System'), { recursive: true });
fs.mkdirSync(path.join(submission, '02_Working_System', 'data'), { recursive: true });
fs.mkdirSync(path.join(submission, '03_Database'), { recursive: true });
fs.mkdirSync(path.join(submission, '04_Reference'), { recursive: true });

for (const file of ['README.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.config.js', 'vercel.json', 'index.html', '.env.example']) {
  fs.copyFileSync(path.join(root, file), path.join(submission, '02_Working_System', file));
}
for (const directory of ['api', 'public', 'server', 'src', 'tests', 'scripts']) {
  copyTree(path.join(root, directory), path.join(submission, '02_Working_System', directory), excluded);
}
fs.copyFileSync(path.join(root, 'data', 'admissions.db'), path.join(submission, '02_Working_System', 'data', 'admissions.db'));
fs.copyFileSync(path.join(root, 'README.md'), path.join(submission, '01_Documentation', 'README_Project.md'));
for (const file of ['ISOM5260_Student_Admission_System_Final_Report.docx', 'ISOM5260_Student_Admission_System_Final_Report.pdf']) {
  fs.copyFileSync(path.join(root, 'docs', file), path.join(submission, '01_Documentation', file));
}
fs.copyFileSync(path.join(root, 'server', 'schema.sql'), path.join(submission, '03_Database', 'schema.sql'));
fs.copyFileSync(path.join(root, 'server', 'reports.js'), path.join(submission, '03_Database', 'reports.js'));
fs.copyFileSync(path.join(root, 'model-catalogue.json'), path.join(submission, '03_Database', 'model-catalogue.json'));
fs.copyFileSync(path.join(root, 'data', 'admissions.db'), path.join(submission, '03_Database', 'admissions.db'));
for (const file of ['ISOM5260 Substitute Project description.v1.pdf', 'ISOM5260 Project Grading Rubrics_Fall2026.pdf']) {
  fs.copyFileSync(path.join(root, file), path.join(submission, '04_Reference', file));
}
fs.writeFileSync(path.join(submission, '00_SUBMISSION_GUIDE.md'), `# HKUST Student Admission System submission\n\nThis package contains the working React/Express/SQLite system, the generated report, the database schema and reproducible fictional data.\n\n- 19 business relations plus the technical schema_migrations table\n- 15 cycle-aware managerial SQL reports\n- HKUST branding is used for coursework presentation only\n- Student coursework demonstration. Fictional records. Not an official HKUST service.\n\nThe Working System can be installed with the package manager used by the project and started with the documented development command.\n`);

const files = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(submission);
if (files.some((file) => /\.db-(?:wal|shm)$|\.DS_Store$|\.icloud-placeholder$|\.env\.local$/.test(file))) {
  throw new Error('Submission contains excluded temporary or credential files');
}
console.log(`Submission rebuilt: ${files.length} files in ${path.relative(root, submission)}`);
console.log(`Create ${path.basename(zipPath)} with: zip -r -X ${path.basename(zipPath)} submission`);
