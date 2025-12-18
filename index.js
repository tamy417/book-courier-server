const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// middlewares
app.use(cors());
app.use(express.json());

// test route
app.get("/", (req, res) => {
  res.send("BookCourier Server is running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
