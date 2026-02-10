const express = require("express");
const session = require("express-session");
const multer = require("multer");
const xlsx = require("xlsx");
const nodemailer = require("nodemailer");
const path = require("path");
const mysql = require('mysql');
const bcrypt = require("bcrypt");
const fs = require("fs");
const app = express();
const PORT = 9007;
let isAdminLoggedIn = false;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const ADMIN_ID = "admin";
const ADMIN_PASS = "admin123";
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_ROWS = 500;
const REQUIRED_COLUMNS = ["email"];
let lastUploadedSheet = [];
const generatePassword = (length = 6) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let pwd = "";
  for (let i = 0; i < length; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
};

const generateUserId = (name, mobile) => {
  const cleanName = (name || "user")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .split(" ")[0];

  const last4 = mobile ? mobile.toString().slice(-4) : "0000";
  return `${cleanName}${last4}`;
};


app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_ID && password === ADMIN_PASS) {
    isAdminLoggedIn = true;        // ✅ SET FIRST
    return res.redirect("/dashboard");
  }

  res.send("<h3>Invalid credentials</h3>");
});
app.get("/dashboard", (req, res) => {
  if (!isAdminLoggedIn) {
    return res.redirect("/");
  }

  res.sendFile(path.join(__dirname, "views", "index.html"));
});


app.get("/logout", (req, res) => {
  isAdminLoggedIn = false;
  res.redirect("/");
});

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    const allowedExts = [".xls", ".xlsx"];
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExts.includes(ext)) {
      return cb(new Error("Only Excel files (.xls, .xlsx) allowed"));
    }

    cb(null, true);
  }
});
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'govind.jha@virtubox.io',
    pass: 'abav kspa ymdf bnbz'
  }
});
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Govind@1234',
  database: 'quiz_app'
});
db.connect((err) => {
  if (err) {
    console.error("❌ MySQL connection failed");
    console.error("Code:", err.code);
    console.error("Message:", err.message);
    process.exit(1);
  }
  console.log("Connected to MySQL database! and vercel");
});


transporter.verify((err) => {
  if (err) {
    console.error("SMTP Error:", err);
  } else {
    console.log("SMTP Ready");
  }
});

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const cleanValue = (val) =>
  typeof val === "string" ? val.trim() : val;


app.post("/upload-sheet", upload.single("sheet"), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    filePath = req.file.path;

    const workbook = xlsx.readFile(filePath);

    if (!workbook.SheetNames.length) {
      return res.status(400).json({ message: "No sheets found in Excel file" });
    }

    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(
      workbook.Sheets[sheetName],
      { defval: "" }
    );

    if (!sheetData.length) {
      return res.status(400).json({ message: "Excel sheet is empty" });
    }

    if (sheetData.length > MAX_ROWS) {
      return res.status(400).json({
        message: `Maximum ${MAX_ROWS} rows allowed`
      });
    }
    lastUploadedSheet = sheetData;

    // Validate required columns
    const columns = Object.keys(sheetData[0]).map(c => c.toLowerCase());
    for (const col of REQUIRED_COLUMNS) {
      if (!columns.includes(col)) {
        return res.status(400).json({
          message: `Missing required column: ${col}`
        });
      }
    }

    let success = 0;
    let failed = 0;
    const errors = [];
    lastUploadedSheet = []; // reset previous data
    for (let i = 0; i < sheetData.length; i++) {
      const row = sheetData[i];
      console.log("➡️ Row start:", row);

      const name = cleanValue(row.name || row.Name);
      const email = cleanValue(row.email || row.Email);
      const mobile = cleanValue(row.mobile || row.Mobile);
      const rollNo = cleanValue(row.roll_no || row.RollNo || "");

      let mailStatus = "Failed";
      let reason = "";
      let userId = "";
      let password = "";

      if (!email || !isValidEmail(email)) {
        reason = "Invalid email";
        failed++;
        continue;
      }

      try {
        userId = generateUserId(name, mobile);
        password = generatePassword(6);
        const existingStudentId = await studentExists(email);

        if (existingStudentId) {
          reason = "Student already exists";
          failed++;

          lastUploadedSheet.push({
            ...row,
            userId: "",
            password: "",
            mailStatus: "Skipped",
            reason
          });

          continue;
        }

        console.log("🟡 Inserting student...");
        const studentId = await insertStudent({
          name,
          email,
          mobile,
          roll_no: rollNo
        });

        console.log("🟢 Student saved, ID:", studentId);

        const passwordHash = await bcrypt.hash(password, 10);

        const userCredentialId = await insertCredentials(
          studentId,
          userId,
          passwordHash
        );
        console.log("🟢 Credentials saved, ID:", userCredentialId);

        await transporter.sendMail({
          from: `"AI Test Access" <${transporter.options.auth.user}>`,
          to: email,
          subject: "Your Login Credentials",
          text: `User ID: ${userId}\nPassword: ${password}`
        });
        await saveEmailLog({
          userCredentialId,
          email,
          status: "SUCCESS"
        });
        console.log("📧 Mail sent");

        mailStatus = "Sent";
        success++;

      } catch (err) {
        console.error("❌ Row failed:", err);
        await saveEmailLog({
          userCredentialId,
          email,
          status: "FAILED",
          errorMessage: mailErr.message
        });
        reason = err.code || "Unknown error";
        failed++;
      }
    }

    res.json({
      message: "Excel processed successfully",
      total: sheetData.length,
      success,
      failed
    });



  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: err.message || "Server error"
    });
  } finally {
    // Cleanup uploaded file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});
function studentExists(email) {
  return new Promise((resolve, reject) => {
    db.query(
      "SELECT id FROM students WHERE email = ? LIMIT 1",
      [email],
      (err, results) => {
        if (err) return reject(err);
        resolve(results.length > 0 ? results[0].id : null);
      }
    );
  });
}
function saveEmailLog({ userCredentialId, email, status, errorMessage }) {
  return new Promise((resolve, reject) => {
    db.query(
      `INSERT INTO email_logs
       (user_credential_id, email, status, error_message)
       VALUES (?, ?, ?, ?)`,
      [userCredentialId, email, status, errorMessage || null],
      (err) => {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function insertStudent(data) {
  return new Promise((resolve, reject) => {
    db.query(
      `INSERT INTO students (name, email, mobile, roll_no)
       VALUES (?, ?, ?, ?)`,
      [data.name, data.email, data.mobile, data.roll_no],
      (err, result) => {
        if (err) {
          console.error("❌ Student insert error:", err);
          return reject(err);
        }
        resolve(result.insertId);
      }
    );
  });
}


function insertCredentials(studentId, username, passwordHash) {
  return new Promise((resolve, reject) => {
    db.query(
      `INSERT INTO user_credentials (student_id, username, password_hash)
       VALUES (?, ?, ?)`,
      [studentId, username, passwordHash],
      (err) => {
        if (err) {
          console.error("❌ Credential insert error:", err);
          return reject(err);
        }
        resolve(true);
      }
    );
  });
}

app.get("/sheet-preview", (req, res) => {

  const query = "SELECT * FROM students";

  db.query(query, (err, results) => {
    if (err || !results.length) {
      return res.send("<h5>No student data found</h5>");
    }

    const headers = Object.keys(results[0]);

    res.send(`
      <div class="card card-primary">
        <div class="card-header">
          <h3 class="card-title">Student List</h3>
        </div>

        <div class="card-body table-responsive">
          <table class="table table-bordered table-striped">
            <thead>
              <tr>
                ${headers.map(h => `<th>${h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${results.map(row => `
                <tr>
                  ${headers.map(h => `
                    <td>${row[h] ?? ""}</td>
                  `).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `);
  });
});

app.get("/email-logs", (req, res) => {
  const query = "SELECT * FROM email_logs ORDER BY id DESC";

  db.query(query, (err, results) => {
    if (err || !results.length) {
      return res.send("<h5>No email logs found</h5>");
    }

    const headers = Object.keys(results[0]);

    res.send(`
      <div class="card card-info">
        <div class="card-header">
          <h3 class="card-title">Email Sent Status</h3>
        </div>

        <div class="card-body table-responsive">
          <table class="table table-bordered table-striped">
            <thead>
              <tr>
                ${headers.map(h => `<th>${h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${results.map(row => `
                <tr>
                  ${headers.map(h => {
      if (h === "status") {
        return `
                        <td>
                          <span class="badge ${row[h] === "SUCCESS"
            ? "badge-success"
            : "badge-danger"
          }">
                            ${row[h]}
                          </span>
                        </td>
                      `;
      }
      return `<td>${row[h] ?? ""}</td>`;
    }).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `);
  });
});

app.get("/create-test", (req, res) => {
  res.send(`
    <div class="card card-success">
      <div class="card-header">
        <h3 class="card-title">Create New Test</h3>
      </div>

      <form method="POST" action="/save-test">
        <div class="card-body">

          <div class="form-group">
            <label>Test Date</label>
            <input type="date" name="test_date" class="form-control" required>
          </div>

          <div class="form-group">
            <label>Subject</label>
            <input type="text" name="subject" class="form-control" required>
          </div>

          <div class="form-group">
            <label>Total Questions</label>
            <input type="number" name="total_questions" class="form-control" required>
          </div>

          <div class="form-group">
            <label>Passing Marks</label>
            <input type="number" name="passing_marks" class="form-control" required>
          </div>

          <div class="form-group">
            <label>Questions (JSON)</label>
            <textarea name="questions_json" rows="8" class="form-control" required>
[
  {
    "q": "When was ICAI established?",
    "options": ["1947", "1948", "1949", "1950"],
    "answer": 2
  }
]
            </textarea>
          </div>

        </div>

        <div class="card-footer">
          <button class="btn btn-success" >
            <i class="fas fa-save"></i> Save Test
          </button>
        </div>
      </form>
    </div>
  `);
});
app.post("/save-test", (req, res) => {
  const {
    test_date,
    subject,
    total_questions,
    passing_marks,
    questions_json
  } = req.body;

  let parsedJSON;

  try {
    let cleanJson = questions_json.trim()
    parsedJSON = JSON.parse(cleanJson);
  } catch (err) {
    return res.send("<h5>Invalid JSON format</h5>");
  }

  const query = `
    INSERT INTO quiz
    (test_date, subject, total_questions, passing_marks, questions_json)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    query,
    [
      test_date,
      subject,
      total_questions,
      passing_marks,
      JSON.stringify(parsedJSON)
    ],
    (err) => {
      if (err) {
        console.error(err);
        return res.send("<h5>Error saving test</h5>");
      }

      res.send(`
        <div class="alert alert-success">
          ✅ Test created successfully
        </div>
      `);
    }
  );
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
