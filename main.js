class Plugin {
    #name
    #lifecycle

    constructor(name, lifecycle = 'ready') {
        this.#name = name
        this.#lifecycle = lifecycle
    }

    init(deck) {
    }
    
    destroy() {
    }

    get name() {
        return this.#name
    }

    get lifecycle() {
        return this.#lifecycle
    }
}

class InteractionPlugin extends Plugin {
    #deck
    #viewportEl
    // TODO: when we have tested that swiping 1:1 works, move all swipe stuff to the swipeInfo object
    #isSwiping = false
    #dragStartPosition
    #currentSlideEl

    // --- swiping 1:1 feedback
    #swipeInfo = {
        currentSlide: null,
        targetSlide: null,
        direction: null,

        progress: 0,
        currentAnimation: null,
        targetAnimation: null
    }
    // -- end of swiping 1:1 feedback

    static #SWIPE_MIN_THRESHOLD = 35
    static #SWIPE_MAX_THRESHOLD = 100
    static #SWIPE_RIBBON_HEIGHT = 40
    static #TRANSITIONABLE_PROPERTIES = ['opacity', 'translate', 'scale', 'rotate', 'transform']
    static #LISTENED_MOUSE_AND_TOUCH_EVENTS = ['touchstart', 'touchend', 'touchmove', 'mousedown', 'mouseup', 'mousemove', 'mouseleave']

    constructor() {
        super('interaction', 'ready')
    }

    init(deck) {
        this.#deck = deck
        this.#viewportEl = deck.containerEl.parentElement
        document.addEventListener('keydown', this.#keyboardListener)
        for (let type of InteractionPlugin.#LISTENED_MOUSE_AND_TOUCH_EVENTS) {
            document.addEventListener(type, this.#mouseMoveListener, { passive: false })
        }
    }
    
    destroy() {
        document.removeEventListener('keydown', this.#keyboardListener)
        for (let type of InteractionPlugin.#LISTENED_MOUSE_AND_TOUCH_EVENTS) {
            document.removeEventListener(type, this.#mouseMoveListener)
        }
    }

    #keyboardListener = e => {
        if (e.key === 'ArrowRight' || e.key === 'Space') {
            this.#deck.navigate(1)
        } else if (e.key === 'ArrowLeft') {
            this.#deck.navigate(-1)
        }
    }

    #mouseMoveListener = e => {
        if (!InteractionPlugin.#LISTENED_MOUSE_AND_TOUCH_EVENTS.includes(e.type)) {
            return
        }
        
        const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX
        const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? e.changedTouches?.[0]?.clientY
        const pageX = e.pageX ?? e.touches?.[0]?.pageX ?? e.changedTouches?.[0]?.pageX
        const pageY = e.pageY ?? e.touches?.[0]?.pageY ?? e.changedTouches?.[0]?.pageY
    
        switch (e.type) {
            case 'touchstart':
            case 'mousedown':
                const isValidButton = e.button === 0 || e.touches?.length === 1
                
                if (this.#insideSwipableArea(clientX, clientY)) {
                    // start swiping
                    if (isValidButton) {
                        // prevents selecting text while swiping
                        e.preventDefault()
                        
                        // sets up swiping
                        this.#isSwiping = true
                        this.#dragStartPosition = { x: pageX, y: pageY }
                        this.#currentSlideEl = this.#deck.slides[this.#deck.currentSlide].el
                        this.#resetSwipeInfo()
                        this.#swipeInfo.currentSlide = this.#deck.currentSlide
                    }
                }
                break

            case 'touchend':
            case 'mouseup':
                if (this.#isSwiping) {
                    // stop swiping
                    const dx = pageX - this.#dragStartPosition.x
                    const offset = dx > 0 ? -1 : 1
                    const exceededThreshold = Math.abs(dx) > InteractionPlugin.#SWIPE_MIN_THRESHOLD
                    if (exceededThreshold && offset == this.#swipeInfo.direction && this.#deck.canNavigate(offset)) {
                        // exceeded the threshold, so we finish the animations and navigate to the next slide
                        this.#swipeInfo.currentAnimation.play()
                        this.#swipeInfo.targetAnimation.play()
                        // actually navigate
                        this.#deck.navigate(offset)

                        // finish the animation
                        this.#swipeInfo.currentAnimation.onfinish = this.#resetSwipeInfo.bind(this)

                    } else if (!!this.#swipeInfo.currentAnimation) {
                        // did not exceed the threshold, so we end the swipe animations letting the current and target
                        // slides return to their original positions
                        if (this.#swipeInfo.progress > 0) {
                            this.#swipeInfo.currentAnimation.reverse()
                            this.#swipeInfo.targetAnimation.reverse()
                            // finish the animation
                            this.#swipeInfo.currentAnimation.onfinish = this.#resetSwipeInfo.bind(this)
                        } else {
                            this.#resetSwipeInfo()
                        }
                    }

                    this.#isSwiping = false
                }
                break

            case 'mouseleave':
                if (this.#isSwiping) {
                    // stop swiping
                    if (!!this.#swipeInfo.currentAnimation) {
                        this.#swipeInfo.currentAnimation.reverse()
                        this.#swipeInfo.targetAnimation.reverse()
                    }
                    this.#resetSwipeInfo()
                    this.#isSwiping = false
                }
                break

            case 'touchmove':
            case 'mousemove':
                if (this.#isSwiping) {
                    // prevents selecting text while swiping
                    e.preventDefault()

                    // swiping
                    // 0. get the swipe direction
                    const dx = pageX - this.#dragStartPosition.x
                    const swipeDirection = (dx > 0) ? 'right' : 'left'
                    const navigationDirection = swipeDirection === 'left' ? 1 : -1

                    // 1. configure the mouse cursor
                    if (this.#deck.canNavigate(navigationDirection)) {
                        this.setCursor('grabbing')
                    } else {
                        this.setCursor('not-allowed')
                        return
                    }
                    

                    // 2. moves the slide with the mouse in a 1:1 ratio
                    // checks if we already know the navigation direction of the ongoing swipe.
                    // if not, we fill in the swipeInfo object with the necessary information
                    if (this.#swipeInfo.direction === null) {
                        this.#swipeInfo.direction = navigationDirection
                        this.#swipeInfo.targetSlide = this.#deck.currentSlide + navigationDirection
                        // 2.1 gets the styles of the current, past and future slides
                        const currentSlideStyles = window.getComputedStyle(this.#currentSlideEl)
                        const futureSlideStyles = this.#getTargetSlideTransitionStyles(this.#currentSlideEl, 1)
                        const pastSlideStyles = this.#getTargetSlideTransitionStyles(this.#currentSlideEl, -1)
                        
                        // 2.2 assigns either a past or future transition style to the current
                        const targetStylesForCurrentSlide = navigationDirection === 1 ? pastSlideStyles : futureSlideStyles
                        this.#swipeInfo.currentAnimation = this.#startSwipeTransitionStyles(this.#currentSlideEl, currentSlideStyles, targetStylesForCurrentSlide)
 
                        // 2.3 assigns a current transition style to the target slide
                        const targetSlideEl = this.#deck.slides[this.#deck.currentSlide + navigationDirection].el
                        const targetStylesForTargetSlide = currentSlideStyles
                        this.#swipeInfo.targetAnimation = this.#startSwipeTransitionStyles(targetSlideEl, window.getComputedStyle(targetSlideEl), targetStylesForTargetSlide)

                        // 2.4 deletes fake slides if they were created
                        this.#deleteFakeSlides(this.#deck.containerEl)
                    }
                        
                    // 2.4 sets the progress of the animations to the current swipe progress (mouse dx)
                    const percentageCompleted = Math.min(0.99, (dx / (-1*this.#swipeInfo.direction)) / InteractionPlugin.#SWIPE_MAX_THRESHOLD)
                    if (percentageCompleted >= 0) {
                        this.#swipeInfo.progress = percentageCompleted
                        this.#swipeInfo.currentAnimation.currentTime = percentageCompleted * this.#swipeInfo.currentAnimation.effect.getTiming().duration
                        this.#swipeInfo.targetAnimation.currentTime = percentageCompleted * this.#swipeInfo.targetAnimation.effect.getTiming().duration
                    } else {
                        // percentage can be negative if user starts swiping in direction -1 and then changes to 1 (or vice-versa)
                        // we just ignore, as we don't want to update the animation
                    }

                } else {
                    // not swiping
                    if (this.#insideSwipableArea(pageX, pageY)) {
                        this.setCursor('grab')
                    } else {
                        this.setCursor('default')
                    }
                }
                break
        }
    }

    #resetSwipeInfo() {
        if (this.#swipeInfo.currentAnimation) {
            this.#swipeInfo.currentAnimation.cancel()
            this.#swipeInfo.targetAnimation.cancel()
        }
        this.#swipeInfo = {
            currentSlide: null,
            targetSlide: null,
            direction: null,

            progress: 0,
            currentAnimation: null,
            targetAnimation: null
        }
    }

    #insideSwipableArea(x, y) {
        const v = this.#viewportEl
        // check if the mouse is inside the swipable area
        if (y < InteractionPlugin.#SWIPE_RIBBON_HEIGHT || 
            y > v.offsetTop + v.offsetHeight - InteractionPlugin.#SWIPE_RIBBON_HEIGHT) {
            return true
        }
        return false
    }

    #getTargetSlideTransitionStyles(currentSlideEl, offset) {
        // 1. checks if there is a real slide in the offset direction
        const targetSlideEl = this.#deck.slides[this.#deck.currentSlide + offset]?.el
        let targetSlideStyles = null
        if (targetSlideEl) {
            // 2. if so, pick its styles
            targetSlideStyles = window.getComputedStyle(targetSlideEl)
        }
        else {
            // 2. if not, create a fake
            const fakeSlideEl = document.createElement('section')
            fakeSlideEl.classList.add('f-slide', 'f-fake')
            fakeSlideEl.style.visibility = 'hidden'

            // 2.1 insert a fake slide after the current slide, so we can get its styles
            const deckEl = currentSlideEl.parentElement
            deckEl.insertBefore(fakeSlideEl, offset == 1 ? 
                currentSlideEl.nextSibling : currentSlideEl)
            
            // 2.2 get the styles of the fake slide
            targetSlideStyles = window.getComputedStyle(fakeSlideEl)
        }
        
        return targetSlideStyles
    }

    #startSwipeTransitionStyles(slideEl, currentStyles, targetStyles) {
        // finds which properties change with the slide transition
        const selectedProperties = []
        for (let prop of InteractionPlugin.#TRANSITIONABLE_PROPERTIES) {
            if (currentStyles[prop] !== targetStyles[prop]) {
                selectedProperties.push(prop)
            }
        }

        // assembles keyframes from and to for the slide animation
        const fromDeclarations = selectedProperties.reduce((obj, prop) => {
            obj[prop] = currentStyles[prop]
            return obj
        }, {})
        const toDeclarations = selectedProperties.reduce((obj, prop) => {
            obj[prop] = targetStyles[prop]
            return obj
        }, {})

        // starts and immediatly pauses the animation, as it is controlled by the mouse
        // outside this function
        const slideAnimation = slideEl.animate([
            fromDeclarations,
            toDeclarations
        ], {
            duration: 200,
            iterations: 1,
            easing: 'linear',
        })
        slideAnimation.pause()

        return slideAnimation
    }

    #deleteFakeSlides(deckEl) {
        deckEl.querySelectorAll('.f-fake').forEach(fakeSlideEl => {
            fakeSlideEl.remove()
        })
    }

    setCursor(value) {
        this.#viewportEl.style.cursor = value
    }
}

class ControlsPlugin extends Plugin {
}

class ScalingPlugin extends Plugin {
    #resizeObserver
    #deck

    constructor() {
        super('scaling', 'parsed-slides')
    }

    init(deck) {
        this.#deck = deck
        this.#wrapSlideElements()
        this.#initializeResizeObserver()
    }

    destroy() {
        this.#resizeObserver.disconnect()
        this.#deck = null
    }

    #wrapSlideElements() {
        const d = this.#deck
        const deckEl = document.createElement('article')
        d.containerEl.insertBefore(deckEl, d.containerEl.firstChild)
        for (const slideEl of d.slides.map(s => s.el)) {
            deckEl.appendChild(slideEl)
        }
        deckEl.classList.add('f-deck')
    }

    #initializeResizeObserver(containerEl) {
        const d = this.#deck
        const viewportEl = d.containerEl.parentElement
        d.containerEl.style.setProperty('--aspect-ratio', `${d.dimensions.aspectRatio}`)
        d.containerEl.style.setProperty('--slide-width', `${d.dimensions.slideWidth}px`)
        d.containerEl.style.setProperty('--slide-height', `${d.dimensions.slideHeight}px`)
        this.#resizeObserver = new ResizeObserver(this.#resizeListener).observe(viewportEl)
    }

    #resizeListener = (entries) => {
        const d = this.#deck
        for (let entry of entries) {
            const newViewportWidth = entry.contentRect.width
            const newViewportHeight = entry.contentRect.height

            const newScale = Math.min(newViewportWidth / d.dimensions.slideWidth, 
                newViewportHeight / d.dimensions.slideHeight)
            // this.#containerEl.style.setProperty('--viewport-width', `${newViewportWidth}px`)
            // this.#containerEl.style.setProperty('--viewport-height', `${newViewportHeight}px`)
            d.containerEl.style.setProperty('--slide-scale', `${newScale}`)
        }
    }
}

class Slide {
    #el
    #deck
    #index
    #hidden

    constructor(el, deck, index) {
        this.#el = el
        this.#deck = deck
        this.#index = index
    }

    activate() {
        this.#el.classList.add('f-active')
    }

    deactivate() {
        this.#el.classList.remove('f-active')
    }

    get el() {
        return this.#el
    }
}

class Deck {
    #containerEl
    #dimensions = {
        aspectRatio: 16 / 9,
        slideWidth: 1024,
        slideHeight: 1024 / (16 / 9)
    }
    #slides = []
    #currentSlide = 0
    #plugins = []
    #state = 'booted'

    static #LIFECYCLES = [
        // booted means that the deck javascript object is constructed and can start parsing the slides
        'booted',
        // parsed-slides means that the slides have been parsed and the deck is ready to have additional interactivity attached
        'parsed-slides',
        // ready means that the deck is fully initialized and ready to be interacted with
        'ready',
        'destroyed'
    ]


    constructor(selector, plugins, extraTransitions = {}) {
        this.#containerEl = document.querySelector(selector)
        if (!this.#containerEl) {
            throw new Error(`No element found for selector: ${selector}`)
        }

        this.#containerEl.classList.add('f-container')
        this.#plugins = plugins

        const slideEls = Array.from(this.#containerEl.children)
        slideEls.forEach(slideEl => slideEl.classList.add('f-slide'))
        this.#slides = slideEls.map((el, index) => new Slide(el, this, index))
    }

    async initialize() {
        // plugin phase: lifecycle 'booted'
        const pluginsAfterBooted = this.#plugins.filter(p => p.lifecycle === 'booted')
        let promises = pluginsAfterBooted.map(p => Promise.resolve(p.init(this)))
        await Promise.all(promises)

        // activates the first slide
        // TODO: look at the hash
        this.#slides[this.#currentSlide].activate()

        // plugin phase: lifecycle 'parsed-slides'
        const pluginsAfterParsedSlides = this.#plugins.filter(p => p.lifecycle === 'parsed-slides')
        promises = pluginsAfterParsedSlides.map(p => Promise.resolve(p.init(this)))
        await Promise.all(promises)

        // plugin phase: lifecycle 'ready'
        const pluginsAfterReady = this.#plugins.filter(p => p.lifecycle === 'ready')
        promises = pluginsAfterReady.map(p => Promise.resolve(p.init(this)))
        await Promise.all(promises)

        return this
    }

    destroy() {
        this.#plugins.forEach(p => p.destroy())
    }

    navigate(offset) {
        const newSlideIndex = this.#currentSlide + offset
        if (!this.canNavigate(offset)) {
            return
        }
        this.#slides[this.#currentSlide].deactivate()
        this.#currentSlide = newSlideIndex
        this.#slides[this.#currentSlide].activate()
    }

    canNavigate(offset) {
        return this.#currentSlide + offset >= 0 && this.#currentSlide + offset < this.#slides.length
    }

    get containerEl() {
        return this.#containerEl
    }

    get slides() {
        return this.#slides
    }

    get dimensions() {
        return this.#dimensions
    }

    get currentSlide() {
        return this.#currentSlide
    }
}


// plugins: markdown, search, math, annotation (canvas)
// classes: slide, deck, future/past?, active, hidden
// events: ready, slide
// interaction: keyboard, mouse click, touch swipe, overview mode
// lifecycle: booting, parsing-slides, ready
// inside core: hash, hidden slides, progress

export default async function fancy(selector, plugins = []) {
    plugins.push(new ScalingPlugin())
    plugins.push(new InteractionPlugin())
    const deck = new Deck(selector, plugins)
    return deck.initialize()
}

