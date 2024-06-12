export default function configureMarkdown(selector) {
    
    return {
        name: 'fancy-markdown',
        lifecycle: 'booted',
        init(deck) {

            const ready = new Promise((resolve) => {
                setTimeout(() => {
                    resolve()
                }, 3000)
            })
            return ready
        },
        destroy() {

        }
    }
}