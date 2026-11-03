# 7lesson Quiz

A free classroom quiz game. The teacher loads a quiz file, children answer live from their phones or tablets. Runs on the teacher's computer — no accounts, no internet hosting, no data leaves the classroom.

## Run

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

The terminal prints two addresses:

- **Teacher** opens `http://localhost:3000/host.html` and chooses a quiz file.
- **Students** (on the same Wi-Fi) open the "Students" address and enter the PIN and a nickname.

## Quiz file format

A `.json` file. See `quizzes/example.json`.

```json
{
  "title": "Fractions",
  "questions": [
    { "question": "1/2 + 1/4 = ?", "answers": ["3/4", "2/6", "1/8", "2/4"], "correct": 0, "time": 20 }
  ]
}
```

| Field | Rule |
|---|---|
| `question` | question text |
| `answers` | 2 to 4 answer options |
| `correct` | number of the right answer, counting from 0 (first answer = 0) |
| `time` | seconds to answer, 5 to 120 |

If the file has a mistake, the teacher page says which question and field is wrong.

## Scoring

A correct answer gives 500–1000 points; faster answers get more. A wrong or missing answer gives 0.
