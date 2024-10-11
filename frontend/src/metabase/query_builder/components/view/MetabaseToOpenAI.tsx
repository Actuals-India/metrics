import { useEffect, useState } from "react";
import { t } from "ttag";

import TextArea from "metabase/core/components/TextArea";
import { Box, Button, Input } from "metabase/ui";
import "./MetabaseToOpenAI.css";

interface SchemaTables {
  schema: string;
  tables: string[];
}

const MetabaseToOpenAI: React.FC = () => {
  const [loading, setLoading] = useState(true); // For tracking the loading state
  const [naturalQuery, setNaturalQuery] = useState(""); // For the user's natural query
  const [result, setResult] = useState(""); // For storing the OpenAI result
  const [schemasAndTables, setSchemasAndTables] = useState(null); // For storing schema and table info
  const [metabaseUrl, setMetabaseUrl] = useState(window.location.origin); // Your Metabase URL

  const fetchDatabaseInfo = async () => {
    try {
      // Step 1: Get list of databases
      const databasesResponse = await fetch(`${metabaseUrl}/api/database`);
      const databasesData = await databasesResponse.json();
      const postgresDb = databasesData.data.find(
        (db: { engine: string }) => db.engine === "postgres",
      );

      console.log("postgresDb", postgresDb);

      if (!postgresDb) {
        throw new Error("No PostgreSQL database found");
      }

      const databaseId = postgresDb.id;

      // Step 2: Get schemas in the database
      const schemasResponse = await fetch(
        `${metabaseUrl}/api/database/${databaseId}/schemas`,
      );
      const schemas: string[] = await schemasResponse.json();

      // Step 3: Get tables and fields for each schema
      const tablesPromises = schemas.map(async (schema: string) => {
        const tablesResponse = await fetch(
          `${metabaseUrl}/api/database/${databaseId}/schema/${schema}`,
        );
        const tables = await tablesResponse.json();

        // Step 4: Fetch fields for each table using table id
        const tablesWithFieldsPromises = tables.map(
          async (table: { id: number; name: string }) => {
            const tableFieldsResponse = await fetch(
              `${metabaseUrl}/api/table/${table.id}/query_metadata`,
            );
            const tableFieldsData = await tableFieldsResponse.json();
            const fields = tableFieldsData.fields
              .map((field: { name: string }) => field.name)
              .filter(
                (name: string) => !name.toLowerCase().includes("airbyte"),
              ); // Filter out columns containing "airbyte"

            return { table: table.name, fields }; // Return table name and its filtered fields
          },
        );

        // Wait for all field data to resolve
        const tablesWithFields = await Promise.all(tablesWithFieldsPromises);

        return { schema, tables: tablesWithFields };
      });

      const schemasAndTablesData = await Promise.all(tablesPromises);

      // Set the schemas and tables data with fields
      setSchemasAndTables(schemasAndTablesData as any);
      setLoading(false); // Done loading, enable the input field
    } catch (error) {
      console.error("Error fetching data from Metabase:", error);
      setLoading(false);
    }
  };

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setLoading(true);

    // Ensure necessary data is available
    if (!naturalQuery || !schemasAndTables) {
      return;
    }

    // Your Lambda API Gateway endpoint
    const apiUrl =
      "https://klukh8gzlj.execute-api.ap-south-1.amazonaws.com/default/openaiQueryLambda";

    let schemasAndTables1 = JSON.stringify({
      schema1: ["users", "transactions"],
      schema2: ["customers", "orders"],
    });

    const payload = {
      naturalQuery,
      schemasAndTables,
    };

    try {
      // Make the POST request to your Lambda function
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload), // Send naturalQuery and schemasAndTables as payload
      });

      // Parse the response from the Lambda function
      const data = await response.json();
      const generatedSQL = data.result; // Access the SQL query result

      setResult(generatedSQL);
      console.log(generatedSQL);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch database info on page load
  useEffect(() => {
    fetchDatabaseInfo();
  }, []);

  return (
    <Box
      id="openai-container"
      mb={4}
      style={{ padding: "20px", width: "30vw" }}
    >
      <div className="flex">
        <div className="text-bold flex" style={{ marginBottom: "1rem" }}>
          {t`Ask me anything`}{" "}
          <img
            src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSEuvTwwljcPXAE-RR-pwFMIA-V6exThLQi8A&s"
            width="20px"
            height="20px"
          />
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        <Box mb={2}>
          <label className="block text-bold " style={{ marginBottom: "15px" }}>
            {t`Enter your query in natural language:`}
          </label>
          <Input
            value={naturalQuery}
            onChange={e => setNaturalQuery(e.target.value)}
            // disabled={loading}
            style={{ marginBottom: "10px" }}
            placeholder={
              loading
                ? t`Loading schemas and tables...`
                : t`Type your query here`
            }
            width="100%"
          />
        </Box>
        <Button
          type="submit"
          disabled={loading || !naturalQuery.trim()}
          style={{ marginBottom: "1rem" }}
        >
          {loading ? t`Loading...` : t`Submit`}
        </Button>
      </form>

      <Box mt={3}>
        <h4 className="text-bold mb-1">{t`Answer:`}</h4>
        <TextArea value={result} readOnly rows={20} style={{ width: "100%" }} />
      </Box>
    </Box>
  );
};

export default MetabaseToOpenAI;
