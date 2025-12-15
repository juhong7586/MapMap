from openai import OpenAI
import os

# How to get your Databricks token: https://docs.databricks.com/en/dev-tools/auth/pat.html
DATABRICKS_TOKEN = os.environ.get('DATABRICKS_TOKEN')
# Alternatively in a Databricks notebook you can use this:
# DATABRICKS_TOKEN = dbutils.notebook.entry_point.getDbutils().notebook().getContext().apiToken().get()

client = OpenAI(
    api_key=DATABRICKS_TOKEN,
    base_url="https://dbc-06a3d50f-3a59.cloud.databricks.com/serving-endpoints"
)

response = client.chat.completions.create(
    model="databricks-gemma-3-12b",
    messages=[
        {
            "role": "user",
            "content": "adsf"
        }
    ],
    max_tokens=5000
)

print(response.choices[0].message.content)