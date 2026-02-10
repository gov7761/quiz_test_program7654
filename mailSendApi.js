const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
        user: "itleads@icai.org",
        pass: "flxqmtfriwmiwgrh"
    }
});

// 🔹 Send Mail API
app.post("/api/send-mail", async (req, res) => {
    try {
        const { email, name } = req.body;

        if (!email || !name) {
            return res.status(400).json({
                success: false,
                message: "email and name are required",
            });
        }

        await transporter.sendMail({
            from: `"Test App" <iew2026@siam.in>`,
            to: email,
            subject: "Welcome Mail",
            html: `
        <h2>Hello ${name},</h2>
        <p>This mail is sent via API 🚀</p>
        <p>Triggered from Postman or any app.</p>
      `,
        });
        

        res.json({
            success: true,
            message: "Mail sent successfully",
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Failed to send mail",
        });
    }
});

app.listen(5000, () => {
    console.log("🚀 Server running on port 5000");
});
