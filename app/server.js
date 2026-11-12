const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());

// ---- Hard-coded login (override with env vars in production) ----
const USER = process.env.ADMIN_USER || 'flexsumit';
const PASS = process.env.ADMIN_PASS || 'mh40ay7550';
const SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

const db = new Database(process.env.DB_PATH || './hms.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS patients(id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, gender TEXT, phone TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS doctors(id INTEGER PRIMARY KEY, name TEXT, specialty TEXT, is_surgeon INTEGER DEFAULT 0, fee INTEGER);
CREATE TABLE IF NOT EXISTS appointments(id INTEGER PRIMARY KEY, patient_id INTEGER, doctor_id INTEGER, type TEXT, date TEXT, time TEXT, notes TEXT, status TEXT DEFAULT 'SCHEDULED', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS lab_tests(id INTEGER PRIMARY KEY, name TEXT, price INTEGER);
CREATE TABLE IF NOT EXISTS lab_orders(id INTEGER PRIMARY KEY, patient_id INTEGER, test_id INTEGER, status TEXT DEFAULT 'PENDING', result TEXT, ordered_at TEXT DEFAULT CURRENT_TIMESTAMP, resulted_at TEXT);
CREATE TABLE IF NOT EXISTS bills(id INTEGER PRIMARY KEY, patient_id INTEGER, description TEXT, amount REAL, method TEXT, reference TEXT, status TEXT DEFAULT 'PAID', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
if (!db.prepare('SELECT COUNT(*) c FROM doctors').get().c) {
  const d = db.prepare('INSERT INTO doctors(name,specialty,is_surgeon,fee) VALUES(?,?,?,?)');
  [['Dr. Meera Iyer','General Medicine',0,500],['Dr. Anil Rao','Cardiology',0,900],['Dr. S. Patil','Paediatrics',0,600],
   ['Dr. Rohan Deshmukh','Orthopaedic Surgeon',1,1500],['Dr. Kavita Joshi','General Surgeon',1,1500],['Dr. Imran Shaikh','Neuro Surgeon',1,2500]]
   .forEach(x => d.run(...x));
  const t = db.prepare('INSERT INTO lab_tests(name,price) VALUES(?,?)');
  [['CBC',350],['Blood Sugar (F/PP)',120],['Lipid Profile',600],['Thyroid Panel',450],['Urine Routine',150],['ECG',300],['X-Ray',400],['MRI',6000]]
   .forEach(x => t.run(...x));
}

// ---- auth ----
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const verify = t => { try { const [b, s] = t.split('.'); if (s !== crypto.createHmac('sha256', SECRET).update(b).digest('base64url')) return null; const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? p : null; } catch { return null; } };
const auth = (req, res, next) => verify((req.headers.authorization || '').replace('Bearer ', '')) ? next() : res.status(401).json({ error: 'Unauthorized' });
const bad = (res, m) => res.status(400).json({ error: m });

app.get('/healthz', (_, res) => res.send('ok'));
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === USER && password === PASS) return res.json({ token: sign({ u: username, exp: Date.now() + 8 * 3600e3 }), user: username });
  res.status(401).json({ error: 'Invalid username or password' });
});

app.use('/api', auth);

// ---- patients & doctors ----
app.get('/api/patients', (_, res) => res.json(db.prepare('SELECT * FROM patients ORDER BY id DESC').all()));
app.post('/api/patients', (req, res) => {
  const { name, age, gender, phone } = req.body;
  if (!name) return bad(res, 'Name required');
  const r = db.prepare('INSERT INTO patients(name,age,gender,phone) VALUES(?,?,?,?)').run(name, age || null, gender || '', phone || '');
  res.json({ id: r.lastInsertRowid });
});
app.get('/api/doctors', (_, res) => res.json(db.prepare('SELECT * FROM doctors').all()));

// ---- appointments: OPD | SPECIAL_SURGERY | DAILY (follow-up/daily visit) ----
app.get('/api/appointments', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let w = '', p = [];
  if (req.query.filter === 'today') { w = 'WHERE a.date=?'; p = [today]; }
  if (req.query.filter === 'surgery') { w = "WHERE a.type='SPECIAL_SURGERY'"; }
  res.json(db.prepare(`SELECT a.*, p.name patient, d.name doctor, d.specialty FROM appointments a
    JOIN patients p ON p.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id ${w} ORDER BY a.date, a.time`).all(...p));
});
app.post('/api/appointments', (req, res) => {
  const { patient_id, doctor_id, type, date, time, notes } = req.body;
  if (!patient_id || !doctor_id || !date || !time) return bad(res, 'Patient, doctor, date and time required');
  const doc = db.prepare('SELECT * FROM doctors WHERE id=?').get(doctor_id);
  if (!doc) return bad(res, 'Doctor not found');
  if (type === 'SPECIAL_SURGERY' && !doc.is_surgeon) return bad(res, 'Select a surgeon for special surgery appointments');
  if (db.prepare("SELECT 1 FROM appointments WHERE doctor_id=? AND date=? AND time=? AND status!='CANCELLED'").get(doctor_id, date, time)) return bad(res, 'Slot already booked for this doctor');
  const r = db.prepare('INSERT INTO appointments(patient_id,doctor_id,type,date,time,notes) VALUES(?,?,?,?,?,?)').run(patient_id, doctor_id, type || 'OPD', date, time, notes || '');
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/appointments/:id', (req, res) => {
  if (!['SCHEDULED', 'COMPLETED', 'CANCELLED'].includes(req.body.status)) return bad(res, 'Bad status');
  db.prepare('UPDATE appointments SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ ok: true });
});

// ---- laboratory ----
app.get('/api/lab/tests', (_, res) => res.json(db.prepare('SELECT * FROM lab_tests').all()));
app.get('/api/lab/orders', (_, res) => res.json(db.prepare(`SELECT o.*, p.name patient, t.name test, t.price FROM lab_orders o
  JOIN patients p ON p.id=o.patient_id JOIN lab_tests t ON t.id=o.test_id ORDER BY o.id DESC`).all()));
app.post('/api/lab/orders', (req, res) => {
  const { patient_id, test_id } = req.body;
  if (!patient_id || !test_id) return bad(res, 'Patient and test required');
  const r = db.prepare('INSERT INTO lab_orders(patient_id,test_id) VALUES(?,?)').run(patient_id, test_id);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/lab/orders/:id', (req, res) => {
  if (!req.body.result) return bad(res, 'Result required');
  db.prepare("UPDATE lab_orders SET result=?, status='READY', resulted_at=CURRENT_TIMESTAMP WHERE id=?").run(req.body.result, req.params.id);
  res.json({ ok: true });
});

// ---- billing: UPI | CASH | CARD ----
app.get('/api/bills', (_, res) => res.json(db.prepare('SELECT b.*, p.name patient FROM bills b JOIN patients p ON p.id=b.patient_id ORDER BY b.id DESC').all()));
app.post('/api/bills', (req, res) => {
  const { patient_id, description, amount, method, reference } = req.body;
  if (!patient_id || !(amount > 0)) return bad(res, 'Patient and a valid amount required');
  if (!['UPI', 'CASH', 'CARD'].includes(method)) return bad(res, 'Payment method must be UPI, CASH or CARD');
  if (method === 'UPI' && !reference) return bad(res, 'Enter UPI transaction/reference ID');
  if (method === 'CARD' && !/^\d{4}$/.test(reference || '')) return bad(res, 'Enter last 4 digits of card');
  const r = db.prepare('INSERT INTO bills(patient_id,description,amount,method,reference) VALUES(?,?,?,?,?)').run(patient_id, description || 'Hospital charges', amount, method, reference || '');
  res.json({ id: r.lastInsertRowid });
});

// ---- dashboard ----
app.get('/api/dashboard', (_, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const q = (s, ...p) => db.prepare(s).get(...p);
  res.json({
    patients: q('SELECT COUNT(*) c FROM patients').c,
    today_appointments: q('SELECT COUNT(*) c FROM appointments WHERE date=?', today).c,
    surgeries: q("SELECT COUNT(*) c FROM appointments WHERE type='SPECIAL_SURGERY' AND status='SCHEDULED'").c,
    pending_labs: q("SELECT COUNT(*) c FROM lab_orders WHERE status='PENDING'").c,
    revenue_today: q('SELECT COALESCE(SUM(amount),0) s FROM bills WHERE date(created_at)=?', today).s,
    by_method: db.prepare('SELECT method, COALESCE(SUM(amount),0) total FROM bills GROUP BY method').all(),
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('HMS running'));
