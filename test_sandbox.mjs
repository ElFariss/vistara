import { runPythonAnalysis } from './src/services/pythonSandbox.mjs';

async function test() {
    const code = `
import pandas as pd
import sys

print('Pandas loaded successfully.')
df = pd.read_excel(sys.argv[1], sheet_name=0)
print(f'Rows: {len(df)}')
`;

    console.log('Running test script...');
    const result = await runPythonAnalysis(code, './shittier_car_mechanic_stress_test_30k_3sheets.xlsx');
    console.log(result);
}

test();
