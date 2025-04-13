import { Kafka } from "kafkajs";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Kafka client
let kafka:any;

if (process.env.ENVIRONMENT === 'local') {
    kafka = new Kafka({
    clientId: "my-app", // Unique client ID for identification in Kafka logs
    brokers: [`${process.env.IP_ADDRESS}:9092`], // Kafka broker address from environment variables
    connectionTimeout: 6000, // Optional: Connection timeout in milliseconds
    requestTimeout: 8000,    // Optional: Timeout for Kafka requests
    retry: {                 // Optional: Retry configuration for robust connections
        retries: 5,          // Number of retries before throwing an error
        initialRetryTime: 300, // Initial retry delay in milliseconds
        maxRetryTime: 3000,   // Maximum retry delay
    },
})
}

export {kafka}