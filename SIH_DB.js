import { MongoClient } from 'mongodb';

const url = 'mongodb://localhost:27017';
const dbName = 'user_credentials';
let client;
let database;

export async function connectDB() {
  try {
    if (database) {
      // If already connected, reuse
      return database;
    }

    client = await MongoClient.connect(url, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    database = client.db(dbName);
    console.log("✅ CONNECTED TO DATABASE:", dbName);
    return database;
  } catch (err) {
    console.error("❌ DATABASE CONNECTION FAILED:", err.message);
    throw err;
  }
}

export default connectDB;
