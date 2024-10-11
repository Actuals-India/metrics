import { useEffect, useState } from "react";
import { t } from "ttag";
import _ from "underscore";

import TextArea from "metabase/core/components/TextArea";
import Questions from "metabase/entities/questions";
import { useDispatch } from "metabase/lib/redux";
import { setUIControls } from "metabase/query_builder/actions";
import { Box, Button, Input } from "metabase/ui";
import * as Lib from "metabase-lib";
import type Question from "metabase-lib/v1/Question";
import {
  getQuestionIdFromVirtualTableId,
  isVirtualCardId,
} from "metabase-lib/v1/metadata/utils/saved-questions";
import type { State } from "metabase-types/store";

import { NotebookSteps } from "./NotebookSteps";

interface NotebookOwnProps {
  className?: string;
  question: Question;
  isDirty: boolean;
  isRunnable: boolean;
  isResultDirty: boolean;
  reportTimezone: string;
  hasVisualizeButton?: boolean;
  updateQuestion: (question: Question) => Promise<void>;
  runQuestionQuery: () => void;
  setQueryBuilderMode: (mode: string) => void;
  readOnly?: boolean;
}

interface EntityLoaderProps {
  sourceQuestion?: Question;
}

type NotebookProps = NotebookOwnProps & EntityLoaderProps;

const Notebook = ({ className, updateQuestion, ...props }: NotebookProps) => {
  const {
    question,
    isDirty,
    isRunnable,
    isResultDirty,
    hasVisualizeButton = true,
    runQuestionQuery,
    setQueryBuilderMode,
  } = props;

  const dispatch = useDispatch();

  async function cleanupQuestion() {
    // Converting a query to MLv2 and back performs a clean-up
    let cleanQuestion = question.setQuery(
      Lib.dropEmptyStages(question.query()),
    );

    if (cleanQuestion.display() === "table") {
      cleanQuestion = cleanQuestion.setDefaultDisplay();
    }

    await updateQuestion(cleanQuestion);
  }

  // visualize switches the view to the question's visualization.
  async function visualize() {
    // Only cleanup the question if it's dirty, otherwise Metabase
    // will incorrectly display the Save button, even though there are no changes to save.
    if (isDirty) {
      cleanupQuestion();
    }
    // switch mode before running otherwise URL update may cause it to switch back to notebook mode
    await setQueryBuilderMode("view");
    if (isResultDirty) {
      await runQuestionQuery();
    }
  }

  const handleUpdateQuestion = (question: Question): Promise<void> => {
    dispatch(setUIControls({ isModifiedFromNotebook: true }));
    return updateQuestion(question);
  };

  // const [loading, setLoading] = useState(true); // For tracking the loading state
  // const [naturalQuery, setNaturalQuery] = useState(""); // For the user's natural query
  // const [result, setResult] = useState(""); // For storing the OpenAI result
  // const [schemasAndTables, setSchemasAndTables] = useState(null); // For storing schema and table info
  // const [metabaseUrl, setMetabaseUrl] = useState(window.location.origin); // Your Metabase URL

  // // Function to fetch databases, schemas, and tables from Metabase
  // // const fetchDatabaseInfo = async () => {
  // //   try {
  // //     // Step 1: Get list of databases
  // //     const databasesResponse = await fetch(`${metabaseUrl}/api/database`);
  // //     const databasesData = await databasesResponse.json();
  // //     const postgresDb = databasesData.data.find(
  // //       (db: { engine: string }) => db.engine === "postgres",
  // //     );

  // //     console.log("postgresDb", postgresDb);

  // //     if (!postgresDb) {
  // //       throw new Error("No PostgreSQL database found");
  // //     }

  // //     const databaseId = postgresDb.id;

  // //     // Step 2: Get schemas in the database
  // //     const schemasResponse = await fetch(
  // //       `${metabaseUrl}/api/database/${databaseId}/schemas`,
  // //     );
  // //     const schemas = await schemasResponse.json();

  // //     // Step 3: Get tables for each schema
  // //     const tablesPromises = schemas.map(async (schema: any) => {
  // //       const tablesResponse = await fetch(
  // //         `${metabaseUrl}/api/database/${databaseId}/schema/${schema}`,
  // //       );
  // //       const tables = await tablesResponse.json();
  // //       return { schema, tables: tables.map((t: { name: any }) => t.name) };
  // //     });

  // //     const schemasAndTablesData = await Promise.all(tablesPromises);

  // //     // Set the schemas and tables data
  // //     setSchemasAndTables(schemasAndTablesData as any);
  // //     setLoading(false); // Done loading, enable the input field
  // //   } catch (error) {
  // //     console.error("Error fetching data from Metabase:", error);
  // //     setLoading(false);
  // //   }
  // // };

  // const fetchDatabaseInfo = async () => {
  //   try {
  //     // Step 1: Get list of databases
  //     const databasesResponse = await fetch(`${metabaseUrl}/api/database`);
  //     const databasesData = await databasesResponse.json();
  //     const postgresDb = databasesData.data.find(
  //       (db: { engine: string }) => db.engine === "postgres",
  //     );

  //     console.log("postgresDb", postgresDb);

  //     if (!postgresDb) {
  //       throw new Error("No PostgreSQL database found");
  //     }

  //     const databaseId = postgresDb.id;

  //     // Step 2: Get schemas in the database
  //     const schemasResponse = await fetch(
  //       `${metabaseUrl}/api/database/${databaseId}/schemas`,
  //     );
  //     const schemas: string[] = await schemasResponse.json();

  //     // Step 3: Get tables and fields for each schema
  //     const tablesPromises = schemas.map(async (schema: string) => {
  //       const tablesResponse = await fetch(
  //         `${metabaseUrl}/api/database/${databaseId}/schema/${schema}`,
  //       );
  //       const tables = await tablesResponse.json();

  //       // Step 4: Fetch fields for each table using table id
  //       const tablesWithFieldsPromises = tables.map(
  //         async (table: { id: number; name: string }) => {
  //           const tableFieldsResponse = await fetch(
  //             `${metabaseUrl}/api/table/${table.id}/query_metadata`,
  //           );
  //           const tableFieldsData = await tableFieldsResponse.json();
  //           const fields = tableFieldsData.fields
  //             .map((field: { name: string }) => field.name)
  //             .filter(
  //               (name: string) => !name.toLowerCase().includes("airbyte"),
  //             ); // Filter out columns containing "airbyte"

  //           return { table: table.name, fields }; // Return table name and its filtered fields
  //         },
  //       );

  //       // Wait for all field data to resolve
  //       const tablesWithFields = await Promise.all(tablesWithFieldsPromises);

  //       return { schema, tables: tablesWithFields };
  //     });

  //     const schemasAndTablesData = await Promise.all(tablesPromises);

  //     // Set the schemas and tables data with fields
  //     setSchemasAndTables(schemasAndTablesData as any);
  //     setLoading(false); // Done loading, enable the input field
  //   } catch (error) {
  //     console.error("Error fetching data from Metabase:", error);
  //     setLoading(false);
  //   }
  // };

  // const handleSubmit = async (e: { preventDefault: () => void }) => {
  //   e.preventDefault();
  //   setLoading(true);
  //   if (!naturalQuery || !schemasAndTables) return;

  //   const apiUrl = "https://api.openai.com/v1/chat/completions";
  //   const apiKey =
  //     "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";

  //   const prompt = `${naturalQuery}, give proper formatting, postgres query and one line explanations for each. \nDatabase schema: ${JSON.stringify(
  //     schemasAndTables,
  //   )}`;

  //   console.log(prompt);

  //   try {
  //     const response = await fetch(apiUrl, {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //         Authorization: `Bearer ${apiKey}`,
  //       },
  //       body: JSON.stringify({
  //         model: "gpt-4o",
  //         messages: [{ role: "user", content: prompt }],
  //         temperature: 0,
  //       }),
  //     });

  //     const data = await response.json();
  //     const generatedSQL = data.choices[0].message.content.trim();
  //     setResult(generatedSQL);
  //     console.log(generatedSQL);
  //   } catch (error) {
  //     console.error("Error:", error);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  // // Fetch database info on page load
  // useEffect(() => {
  //   fetchDatabaseInfo();
  // }, []);

  return (
    <Box pos="relative" p={{ base: "1rem", sm: "2rem" }}>
      {/* <Box id="openai-container" mb={4}>
        <h3
          className="text-bold"
          style={{ marginBottom: "1rem" }}
        >{t`Generate SQL Query`}</h3>

        <form onSubmit={handleSubmit}>
          <Box mb={2}>
            <label
              className="block text-bold mb-1"
              style={{ marginBottom: "8px" }}
            >
              {t`Enter your query in natural language:`}
            </label>
            <Input
              value={naturalQuery}
              onChange={e => setNaturalQuery(e.target.value)}
              disabled={loading}
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
            {t`Submit`}
          </Button>
        </form>

        <Box mt={3}>
          <h4 className="text-bold mb-1">{t`Generated SQL Query:`}</h4>
          <TextArea
            value={result}
            readOnly
            rows={10}
            style={{ width: "100%" }}
          />
        </Box>
      </Box> */}

      <NotebookSteps updateQuestion={handleUpdateQuestion} {...props} />
      {hasVisualizeButton && isRunnable && (
        <Button variant="filled" style={{ minWidth: 220 }} onClick={visualize}>
          {t`Visualize`}
        </Button>
      )}
    </Box>
  );
};
function getSourceQuestionId(question: Question) {
  const query = question.query();
  const { isNative } = Lib.queryDisplayInfo(query);

  if (!isNative) {
    const sourceTableId = Lib.sourceTableOrCardId(query);

    if (isVirtualCardId(sourceTableId)) {
      return getQuestionIdFromVirtualTableId(sourceTableId);
    }
  }

  return undefined;
}

// eslint-disable-next-line import/no-default-export -- deprecated usage
export default _.compose(
  Questions.load({
    id: (state: State, { question }: NotebookOwnProps) =>
      getSourceQuestionId(question),
    entityAlias: "sourceQuestion",
    loadingAndErrorWrapper: false,
  }),
)(Notebook);
