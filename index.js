const express = require("express");
const cors = require("cors");
require("dotenv").config();
const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.cert(
    require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
  ),
});

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

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Invalid token" });
  }
};

const verifyAdmin = async (req, res, next) => {
  const email = req.user.email;

  const user = await client
    .db("bookCourierDB")
    .collection("users")
    .findOne({ email });

  if (!user || user.role !== "admin") {
    return res.status(403).send({ message: "Admin access required" });
  }

  next();
};

const verifyLibrarian = async (req, res, next) => {
  const email = req.user.email;

  const user = await client
    .db("bookCourierDB")
    .collection("users")
    .findOne({ email });

  if (!user || user.role !== "librarian") {
    return res.status(403).send({ message: "Librarian access required" });
  }

  next();
};

async function run() {
  try {
    await client.connect();
    console.log("MongoDB connected successfully");

    const usersCollection = client.db("bookCourierDB").collection("users");
    const booksCollection = client.db("bookCourierDB").collection("books");
    const ordersCollection = client.db("bookCourierDB").collection("orders");
    const wishlistCollection = client
      .db("bookCourierDB")
      .collection("wishlist");
    const reviewsCollection = client.db("bookCourierDB").collection("reviews");

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
    app.post("/books", verifyToken, verifyLibrarian, async (req, res) => {
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
    app.post("/orders", verifyToken, async (req, res) => {
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
    app.get("/orders", verifyToken, async (req, res) => {
      if (req.user.email !== req.query.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const email = req.query.email;
      const query = { userEmail: email };

      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });

    // cancel order (only if pending)
    app.patch("/orders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      const order = await ordersCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!order || order.userEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      if (order.orderStatus !== "pending") {
        return res
          .status(400)
          .send({ message: "Only pending orders can be cancelled" });
      }

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { orderStatus: "cancelled" } }
      );

      res.send(result);
    });

    // update order status (librarian)
    app.patch(
      "/orders/status/:id",
      verifyToken,
      verifyLibrarian,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;

        const allowedStatus = ["shipped", "delivered"];
        if (!allowedStatus.includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: { orderStatus: status } };

        const result = await ordersCollection.updateOne(query, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Order not found" });
        }

        if (result.modifiedCount === 0) {
          return res.send({
            message: "Order status already set",
            acknowledged: true,
          });
        }

        res.send({ message: "Order status updated", acknowledged: true });
      }
    );

    // Delete related orders
    app.delete("/books/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;

      const result = await booksCollection.deleteOne({
        _id: new ObjectId(id),
      });

      await ordersCollection.deleteMany({ bookId: id });

      res.send(result);
    });

    // Publish / Unpublish book (Admin)
    app.patch(
      "/books/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;

        if (!["published", "unpublished"].includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const result = await booksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        res.send(result);
      }
    );

    // Add to wishlist
    app.post("/wishlist", verifyToken, async (req, res) => {
      const item = req.body;

      const result = await wishlistCollection.insertOne({
        bookId: item.bookId,
        userEmail: req.user.email,
        addedAt: new Date(),
      });

      res.send(result);
    });

    // Get user wishlist
    app.get("/wishlist", verifyToken, async (req, res) => {
      const email = req.user.email;

      const result = await wishlistCollection
        .find({ userEmail: email })
        .toArray();
      res.send(result);
    });

    // Review (ONLY if ordered)
    app.post("/reviews", verifyToken, async (req, res) => {
      const review = req.body;

      const hasOrdered = await ordersCollection.findOne({
        bookId: review.bookId,
        userEmail: req.user.email,
        paymentStatus: "paid",
      });

      if (!hasOrdered) {
        return res.status(403).send({ message: "Order required to review" });
      }

      const result = await reviewsCollection.insertOne({
        bookId: review.bookId,
        rating: review.rating,
        comment: review.comment,
        userEmail: req.user.email,
        createdAt: new Date(),
      });

      res.send(result);
    });

    // Get reviews for a book
    app.get("/reviews/:bookId", async (req, res) => {
      const bookId = req.params.bookId;

      const result = await reviewsCollection.find({ bookId }).toArray();
      res.send(result);
    });

    // Search & Sort Books
    app.get("/books/search", async (req, res) => {
      const { search, sort } = req.query;

      let query = { status: "published" };

      if (search) {
        query.title = { $regex: search, $options: "i" };
      }

      let cursor = booksCollection.find(query);

      if (sort === "asc") cursor = cursor.sort({ price: 1 });
      if (sort === "desc") cursor = cursor.sort({ price: -1 });

      const result = await cursor.toArray();
      res.send(result);
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
