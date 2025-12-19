const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.j4lmmay.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("MongoDB connected successfully");

    const usersCollection = client.db("bookCourierDB").collection("users");
    const booksCollection = client.db("bookCourierDB").collection("books");
    const ordersCollection = client.db("bookCourierDB").collection("orders");

    // test route
    app.get("/", (req, res) => {
      res.send("BookCourier Server Running");
    });

    app.post("/users", async (req, res) => {
      const user = req.body;

      if (!user.email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const result = await usersCollection.insertOne({
        name: user.name || "",
        email: user.email,
        role: "user",
        createdAt: new Date(),
      });

      res.send(result);
    });

    // add a book
    app.post("/books", async (req, res) => {
      const book = req.body;

      if (!book.title || !book.author || !book.price) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      const newBook = {
        title: book.title,
        author: book.author,
        image: book.image || "",
        price: book.price,
        status: book.status || "published", // published / unpublished
        librarianEmail: book.librarianEmail,
        createdAt: new Date(),
      };

      const result = await booksCollection.insertOne(newBook);
      res.send(result);
    });

    // get all published books
    app.get("/books", async (req, res) => {
      const query = { status: "published" };
      const result = await booksCollection.find(query).toArray();
      res.send(result);
    });

    // place an order
    app.post("/orders", async (req, res) => {
      const order = req.body;

      if (!order.bookId || !order.userEmail) {
        return res.status(400).send({ message: "Invalid order data" });
      }

      const newOrder = {
        bookId: order.bookId,
        bookTitle: order.bookTitle,
        price: order.price,
        userName: order.userName,
        userEmail: order.userEmail,
        phone: order.phone,
        address: order.address,
        orderStatus: "pending",
        paymentStatus: "unpaid",
        orderDate: new Date(),
      };

      const result = await ordersCollection.insertOne(newOrder);
      res.send(result);
    });

    // get orders by user email
    app.get("/orders", async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };

      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });

    // cancel order (only if pending)
    app.patch("/orders/:id", async (req, res) => {
      const id = req.params.id;

      const query = {
        _id: new ObjectId(id),
        orderStatus: "pending",
      };

      const updateDoc = {
        $set: {
          orderStatus: "cancelled",
        },
      };

      const result = await ordersCollection.updateOne(query, updateDoc);
      res.send(result);
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
