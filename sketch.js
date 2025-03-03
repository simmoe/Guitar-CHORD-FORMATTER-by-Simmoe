let currentPage = 1
let pages

function setup() {
    noCanvas();
    pages = selectAll('.page');
    
    // Hent elementer fra HTML
    let inputArea = select('#inputArea');
    let formatButton = select('#formatButton');
    let outputDiv = select('#outputDiv').addClass('scrollable');
    let backButton = select('#backButton');

    // Når outputDiv klikkes, toggler vi full-screen klassen
    outputDiv.mouseClicked(() => {
        outputDiv.toggleClass('full-screen');
    });
    
    // Event listeners
    formatButton.mousePressed(() => {
        formatLyrics(inputArea, outputDiv);
        shiftPage(2);
    });
            
    backButton.mousePressed(() => {
        inputArea.value('')
        outputDiv.html('')
        shiftPage(1);
    });
}


function formatLyrics(inputArea, outputDiv) {
    let inputText = inputArea.value()
    let lines = inputText.split('\n')
    let formattedOutput = []

    //hvis sidste linje var en akkord linje - og denne linje er en tekst linje skal vi lægge dem sammen
    let p = 'not-chords'

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i]

        //skema linje - udelades 
        if(line.includes('--')){
            //formattedOutput.push(`<div class='schematic-line'>${line}</div>`)
            p = 'not-chords'
        }
        //form linje - udskiftes med linebreak 
        else if(line.includes('[') || line.includes('Chorus') || line.includes('Verse')){
            console.log('added line break')
            formattedOutput.push(`<div class='form-line'><br></div>`)
            p = 'not-chords'
        }
        //akkordlinje
        else if (
/^[A-G][#b]?(maj7|m7|m|7|dim|sus[24]|add\d+)?(\/[A-G][#b]?)?,?(\s+[A-G][#b]?(maj7|m7|m|7|dim|sus[24]|add\d+)?(\/[A-G][#b]?)?,?)*$/
            .test(line.trim())) {
            //console.log('chord line')
            p = 'chords'
            //formattedOutput.push(`<div class='chord-line'>${line}</div>`)
        } 
        // Hvis næste linje er en tekstlinje, par den korrekt
        else if (line.trim() != '') {
            //console.log('lyrics line', p, i, formattedOutput.length)
            if(p == 'chords'){
                //læg linjerne sammen
                let combine = formatChordTextPair(lines[i-1], line)
                formattedOutput.push(`<div class='text-chord-line'>${combine}</div>`)
                p = "not-chords"
            }
        } 
        else {
            //formattedOutput.push(`<div class='neither-line'>${line}</div>`)
            p = "not-chords"
        }
    }
    outputDiv.style('white-space', 'pre-wrap');
    outputDiv.html(formattedOutput.join('\n'));
}



function formatChordTextPair(chordLine, lyricLine) {
    let formattedLine = '';
    let chordMatches = [];
    // Regex der matcher akkorder inkl. m7, add-typer, og et valgfrit komma
    let regex = /([A-G][#b]?(maj7|m7|m|7|dim|sus[24]|add\d+)?(\/[A-G][#b]?)?,?)/g;
    let match;
    
    while ((match = regex.exec(chordLine)) !== null) {
        chordMatches.push({ index: match.index, chord: match[0] });
    }
    
    let lastIndex = 0;
    let spaceOffset = 0; // Ekstra forskydning for korrekt placering
    let chordsAfterCount = 0; // Tæller akkorder efter lyricLine
    
    for (let i = 0; i < chordMatches.length; i++) {
        let { index, chord } = chordMatches[i];
        let spacesBefore = (chordLine.substring(lastIndex, index).match(/ /g) || []).length;
        let insertPos = lastIndex + spacesBefore + spaceOffset;
        if (insertPos > lyricLine.length) insertPos = lyricLine.length;
        
        if (insertPos === lyricLine.length) {
            // Akkorden skal indsættes efter lyricLine
            formattedLine += lyricLine.substring(lastIndex, insertPos);
            // Hvis det ikke er den første akkord efter teksten, tilføj taktmarkør inde i chord-elementet
            if (chordsAfterCount > 0) {
                formattedLine += `<sup>| ${chord}</sup> `;
            } else {
                formattedLine += `<sup class='chord'>${chord}</sup> `;
            }
            lastIndex = insertPos;
            chordsAfterCount++;
            spaceOffset += chord.length + 3;
        } else {
            // Akkorden indsættes midt i lyricLine – nulstil count for akkorder efter teksten
            chordsAfterCount = 0;
            // Juster indsætningspunktet, hvis det falder midt i et ord
            if (insertPos > 0 && insertPos < lyricLine.length &&
                lyricLine[insertPos - 1] !== ' ' && lyricLine[insertPos] !== ' ') {
                let leftPos = insertPos;
                while (leftPos > 0 && lyricLine[leftPos - 1] !== ' ') {
                    leftPos--;
                }
                let rightPos = insertPos;
                while (rightPos < lyricLine.length && lyricLine[rightPos] !== ' ') {
                    rightPos++;
                }
                let distLeft = insertPos - leftPos;
                let distRight = rightPos - insertPos;
                insertPos = (distLeft <= distRight) ? leftPos : rightPos;
            }
            let padding = (formattedLine.endsWith('</sup>') ? ' ' : '');
            formattedLine += lyricLine.substring(lastIndex, insertPos) + padding + `<sup>${chord}</sup> `;
            lastIndex = insertPos;
            spaceOffset += chord.length + 3;
        }
    }
    
    formattedLine += lyricLine.substring(lastIndex);
    return formattedLine;
}




function shiftPage(num) {
    if(num == "ArrowLeft"){
        num = currentPage - 1;
    }
    if(num == "ArrowRight"){
        num = currentPage + 1;
    }

    if(isNaN(num) || num > pages.length || num == 0){
        return;
    }
    select("#page" + currentPage).removeClass('visible');
    currentPage = num;
    select("#page" + currentPage).addClass('visible');
}

function keyPressed(){
    shiftPage(key);
}

    

// Fallback til ældre browsere
function fallbackCopy(text) {
    let textArea = document.createElement("textarea")
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand("copy")
    document.body.removeChild(textArea)
}
