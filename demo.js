import fancy from './main.js'
import math from './fancy-math.js'
import markdown from './fancy-markdown.js'

const presentation = await fancy('.f-container', [
    markdown(),
    math(),
], {
    subtle: {
        past: {
            translate: '-10% 0%'
        },
        future: {
            translate: '10% 0%'
        }
    }
})

console.log(`Finished loading the ${presentation}`)
