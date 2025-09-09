// DOM elements
const startBtn = document.querySelector('.start-btn');
const popupInfo = document.querySelector('.popup-info');
const exitBtn = document.querySelector('.exit-btn');
const main = document.querySelector('.main');
const continueBtn = document.querySelector('.continue-btn');
const qSection = document.querySelector('.questions-section');
const options = document.querySelectorAll('.option');
const resultBox = document.querySelector('.result-box');
const resultText = document.querySelector('.results');
const nextBtn = document.querySelector('.next-btn');

// PHQ-9 answers storage
class Answers {
    constructor() {
        this.val = [];
        this.temp = 0;
        this.resultRespose = [];
    }
    addAnswers = (answer) => {
        this.val.push(answer);
    }
    addValue(value) {
        this.temp = value;
    }
    showAnswers() {
        return this.val;
    }
}

const ans = new Answers();
let questionCount = 0;
let questionNumb = 1;

// Option click logic
options.forEach(option => {
    option.addEventListener('click', () => {
        options.forEach(o => o.classList.remove('active'));
        option.classList.add('active');
        ans.temp = option.textContent.trim();
    });
});

// Start button
startBtn.onclick = () => {
    popupInfo.classList.add('active');
    main.classList.add('active');
}

// Exit popup
exitBtn.onclick = () => {
    popupInfo.classList.remove('active');
    main.classList.remove('active');
}

// Continue popup
continueBtn.onclick = () => {
    qSection.classList.add('active');
    popupInfo.classList.remove('active');
    main.classList.remove('active');
    showQuestions(0);
    questionCounter(1);
}

// Display question
function showQuestions(index) {
    const questionText = document.querySelector('.question-text');
    questionText.textContent = `${questions[index].numb}. ${questions[index].question}`;

    const optionElems = document.querySelectorAll('.option');
    for (let i = 0; i < optionElems.length; i++) {
        optionElems[i].classList.remove('active');
    }
}

// Update question counter
function questionCounter(index) {
    const questionTotal = document.querySelector('.total-questions');
    questionTotal.textContent = `${index}/10 Questions`;
}

// Next button click
nextBtn.onclick = () => {
    if (!ans.temp) {
        alert("Please select an option before continuing!");
        return;
    }
    ans.addAnswers(ans.temp);
    ans.temp = 0;

    if (questionCount < questions.length - 1) {
        questionCount++;
        questionNumb++;
        showQuestions(questionCount);
        questionCounter(questionNumb);
    } else {
        ans.resultRespose = questions.map((items, index) => {
            let temp = { ...items };
            temp.optionSelected = ans.val[index];
            delete temp.options;
            delete temp.numb;
            return temp;
        });

        console.table(ans.resultRespose);

        // ✅ Include username in payload
        fetch('/questions_analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: currentUser,
                answers: ans.resultRespose
            })
        })
        .then(res => res.json())
        .then(data => {
            resultText.textContent = data.reply;
            resultBox.classList.add('active');
        })
        .catch(err => {
            console.error("Error sending answers:", err);
            resultText.textContent = "Something went wrong. Please try again.";
            resultBox.classList.add('active');
        });
    }
}
