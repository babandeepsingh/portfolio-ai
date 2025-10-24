import { NextRequest, NextResponse } from "next/server";
import sampleData from "./sample-data.json" with {type: "json"};
import { Pinecone } from '@pinecone-database/pinecone';
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

// import { DataAPIClient } from "@datastax/astra-db-ts";
import { DataAPIClient, Db } from "@datastax/astra-db-ts";
import OpenAI from 'openai';
// {
//   "clientId": "WnGcGUdlnKmkeDlwTTnwRPab",
//   "secret": "2opC-O.ztW7AJfBzdX_ZEc0Y9anyaYUW,KyvF5zaU4IIgiFZ,coOBpZ6YlP91ujawQll84yRx-wxXUw6NAnr9c_CQUMUR_CglnvoOcf3nkdmzJ6Ohv8DdaUOlhFNMQAq",
//   "token": "AstraCS:WnGcGUdlnKmkeDlwTTnwRPab:69aee2b8d2f2854e070e1b998192ba04eeb64f7269bf637bcb50060c867eb8e9"
// }

// const client = new DataAPIClient('AstraCS:hlYuLICzRoevlFbeFJEIAGLf:22a816a309a19821ec339b66c35c2794106e89e9f5f79a3c3d9720385dfa8077');
// const client = new DataAPIClient({
//   "clientId": "WnGcGUdlnKmkeDlwTTnwRPab",
//   "secret": "2opC-O.ztW7AJfBzdX_ZEc0Y9anyaYUW,KyvF5zaU4IIgiFZ,coOBpZ6YlP91ujawQll84yRx-wxXUw6NAnr9c_CQUMUR_CglnvoOcf3nkdmzJ6Ohv8DdaUOlhFNMQAq",
//   "token": "AstraCS:WnGcGUdlnKmkeDlwTTnwRPab:69aee2b8d2f2854e070e1b998192ba04eeb64f7269bf637bcb50060c867eb8e9"
// }
// )
// const db = client.db('https://4a91d4fc-0ecc-48c1-97b0-b0d051f89d1c-us-central1.apps.astra-dev.datastax.com', { keyspace: "default_keyspace" });
const client = new DataAPIClient('AstraCS:hlYuLICzRoevlFbeFJEIAGLf:22a816a309a19821ec339b66c35c2794106e89e9f5f79a3c3d9720385dfa8077');

const db = client.db('https://1bb37341-97f8-4d0a-b93f-b95743d708c3-us-east-2.apps.astra.datastax.com', { keyspace: "default_keyspace" });

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
(async () => {
    const colls = await db.listCollections();
    console.log('Connected to AstraDB:', colls);
})();
export async function GET(req: NextRequest, context: any) {
    console.log(process.env.OPENAI_API_KEY)

    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
    });


    const createCollection = async () => {
        try {
            await db.createCollection("portfolio", {
                vector: {
                    dimension: 1536,
                }
            })
        } catch (error) {
            console.log("Collection Already Exists", error);
        }
    }
    const loadData = async () => {
        const collection = await db.collection("portfolio")
        for await (const { id, info, description } of sampleData) {
            const chunks = await splitter.splitText(description);
            let i = 0;
            for await (const chunk of chunks) {
                const { data } = await openai.embeddings.create({
                    input: chunk,
                    model: "text-embedding-3-small"
                })

                const res = await collection.insertOne({
                    document_id: id,
                    $vector: data[0]?.embedding,
                    info,
                    description: chunk
                })

                i++
            }
        }

        console.log("data added");
    }

    createCollection().then(() => loadData())
    // console.log(texts, "Here")
    // return NextResponse.json({ error: "Internal Server Error", message: 'unable to retreive user' });
}
